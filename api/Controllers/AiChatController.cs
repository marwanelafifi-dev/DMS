using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/ai-chat")]
public class AiChatController(
    DmsContext context,
    AccessOverrideService accessOverrideService,
    IHttpClientFactory httpClientFactory,
    AiChatSettingsService settingsService,
    AiChatPromptsService promptsService,
    UserGoogleCalendarService calendarService,
    OcrIndexService ocrIndexService,
    AuditService auditService,
    ILogger<AiChatController> logger) : BaseController
{
    private const string AccessDeniedAnswer = "You should get access first. Call your system administrator to provide you with the correct access so I can answer your question.";
    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "about", "after", "again", "also", "and", "answer", "are", "can", "content", "could", "details", "document", "file",
        "for", "from", "have", "how", "into", "its", "me", "please", "that", "the", "their", "them",
        "there", "these", "this", "those", "information", "know", "show", "tell", "what", "when", "where", "which", "who", "why", "with", "would", "you", "your"
    };

    [HttpPost]
    public async Task<ActionResult<object>> Ask([FromBody] AiChatRequest request, CancellationToken cancellationToken)
    {
        var question = request.Message?.Trim();
        if (string.IsNullOrWhiteSpace(question))
            return BadRequest(new { success = false, error = "Please enter a question." });
        if (question.Length > 2000)
            return BadRequest(new { success = false, error = "Questions must be 2,000 characters or fewer." });

        var prompts = await promptsService.LoadAsync();
        var userId = GetCurrentUserId();
        var accessibleFolderIds = await GetAccessibleFolderIdsAsync(context, userId, accessOverrideService);
        var accessibleDocumentsQuery = context.Documents.AsNoTracking();
        if (accessibleFolderIds != null)
            accessibleDocumentsQuery = accessibleDocumentsQuery.Where(d => accessibleFolderIds.Contains(d.FolderId));

        var candidateDocuments = await (
            from document in accessibleDocumentsQuery
            join version in context.DocumentVersions.AsNoTracking()
                on document.CurrentVersionId equals (Guid?)version.VersionId into versions
            from version in versions.DefaultIfEmpty()
            select new ChatDocument(document.DocumentId, document.FolderId, document.Title, version == null ? null : version.FileName,
                document.OriginalDocumentId, document.Description, document.Status, document.CurrentVersionId))
            .ToListAsync(cancellationToken);
        var accessibleDocuments = new List<ChatDocument>();
        foreach (var document in candidateDocuments)
        {
            if (await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId))
                accessibleDocuments.Add(document);
        }
        var accessibleById = accessibleDocuments.ToDictionary(d => d.DocumentId.ToString(), StringComparer.OrdinalIgnoreCase);

        var explicitMatch = ResolveExplicitDocument(question, accessibleDocuments);
        if (explicitMatch.AmbiguousCandidates.Count > 1)
        {
            // More than one accessible document shares this name (a real case:
            // two documents both titled essentially "Backup Process Techniques").
            // Guessing which one silently would risk answering from the wrong
            // document without the user ever knowing — ask instead.
            var clarification = await BuildAmbiguousDocumentAnswerAsync(explicitMatch.AmbiguousCandidates);
            return Ok(new { success = true, data = new { answer = clarification, accessDenied = false, sources = Array.Empty<object>() } });
        }
        var explicitDocument = explicitMatch.Document;

        // Sticky document context: once a document has been established in this
        // conversation, every later question stays about that same document by
        // default — regardless of phrasing ("it", "the document", or no reference
        // cue at all, e.g. "let me know the KPIs"). The only ways to leave it are
        // (1) the current question explicitly names a different accessible
        // document (handled above), (2) an explicit request to change the
        // source/document, or (3) the question clearly isn't about a document at
        // all (tasks/calendar/announcements/dashboard with no document wording).
        var recentConversation = BuildRecentConversation(request.History);
        if (explicitDocument == null && !string.IsNullOrEmpty(recentConversation)
            && !DocumentContextResetPhrase.IsMatch(question)
            && !LooksLikeNonDocumentTopic(question))
        {
            explicitDocument = FindMostRecentlyMentionedDocument(recentConversation, accessibleDocuments);
        }

        // Last resort before falling through to broad keyword search — no exact
        // name match and no active sticky-context document, but the question
        // still shares a distinctive word (not just any word — see
        // FindWordOverlapCandidates) with more than one accessible document's
        // name (e.g. "Backup" between "Backup Techniques" and "Backup Process-
        // Techniques"). Deliberately placed after sticky context, never before
        // it — a real follow-up in an ongoing document conversation must not get
        // derailed just because it happens to repeat a word from that document's
        // own name. Also skipped outright for a question that clearly isn't about
        // a document at all (tasks/calendar/announcements/dashboard/admin-info) —
        // a real bug found live: "what is the role of this user" shares "role"
        // and "user" with several unrelated document titles (Access Rights
        // Matrix, User Security Policy, ...) purely by coincidence, which kept
        // sending every admin-info question into a document-disambiguation
        // prompt before the AdminInfo intent below ever got a chance to run.
        if (explicitDocument == null && !LooksLikeNonDocumentTopic(question))
        {
            var wordOverlapCandidates = FindWordOverlapCandidates(question, accessibleDocuments);
            if (wordOverlapCandidates.Count > 1)
            {
                var clarification = await BuildAmbiguousDocumentAnswerAsync(wordOverlapCandidates);
                return Ok(new { success = true, data = new { answer = clarification, accessDenied = false, sources = Array.Empty<object>() } });
            }
        }

        var containsFileExtension = Regex.IsMatch(question, @"\.(pdf|docx?|docm|xlsx?|xlsm|pptx?|pptm|txt|csv|png|jpe?g|tiff?)\b", RegexOptions.IgnoreCase);
        // A labeled Doc ID reference ("Doc ID SWS-25120007", "doc no. XYZ-123") that
        // doesn't resolve to an accessible document must not fall through to the
        // noisy broad keyword search — a generic word like "Doc" in the question
        // can otherwise dominate the ranking and surface unrelated documents while
        // silently missing the actual Doc ID the user asked for. Requiring the
        // labeling phrase (not just any doc-ID-shaped token) avoids misfiring on
        // ordinary standard references like "ISO-9001".
        var looksLikeUnresolvedDocIdReference = explicitDocument == null
            && Regex.IsMatch(question, @"\b(doc\s*id|doc\s*no\.?|document\s*id|document\s*number)\b", RegexOptions.IgnoreCase)
            && DocIdLikeToken.IsMatch(question);
        if (explicitDocument == null && (containsFileExtension || looksLikeUnresolvedDocIdReference))
        {
            const string exactFileAnswer = "I couldn't find that exact file among the documents you can access. Check the file name or Doc ID, or contact your system administrator to request access.";
            return Ok(new { success = true, data = new { answer = exactFileAnswer, accessDenied = true, sources = Array.Empty<object>() } });
        }

        // Query understanding only matters for the broad-search path — every use of
        // `intent`/`searchTerms` below is gated on explicitDocument being null, so
        // skip the extra LLM round trip entirely for a question that already
        // resolved to one exact, permission-checked file.
        ChatIntent intent;
        string[] searchTerms;
        if (explicitDocument == null)
        {
            var queryUnderstanding = await AnalyzeQueryAsync(question, recentConversation, prompts.QueryUnderstandingPrompt, cancellationToken);
            intent = queryUnderstanding != null ? NormalizeIntent(queryUnderstanding) : DetectIntent(question);
            searchTerms = queryUnderstanding is { SearchTerms.Count: > 0 }
                ? queryUnderstanding.SearchTerms.Take(6).ToArray()
                : ExtractSearchTerms(question).Take(8).ToArray();
        }
        else
        {
            intent = new ChatIntent(false, false, false, false, false, false);
            searchTerms = [];
        }

        // System administration data (users, groups, roles) is Full-Access-only,
        // regardless of any per-folder grant — the same "Full Access acts as admin
        // everywhere" boundary every other admin-only AI Assistant capability in
        // this controller already uses. Checked up front and denied explicitly
        // rather than silently omitting the category, since a Full-Access-only
        // question falling through to an unrelated document search would be far
        // more confusing than a clear "you need Full Access" answer.
        var canViewAdminInfo = false;
        if (explicitDocument == null && intent.AdminInfo)
        {
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (pageAccessRole?.BypassFolderPermissions != true)
            {
                const string adminInfoDenied = "Only a Full Access role can view system administration data (users, groups, roles) through the assistant. Contact your system administrator if you need this.";
                return Ok(new { success = true, data = new { answer = adminInfoDenied, accessDenied = true, sources = Array.Empty<object>() } });
            }
            canViewAdminInfo = true;
        }

        List<OcrRow> ocrRows;
        var reindexAttempted = false;
        if (explicitDocument != null)
        {
            var exactRow = await GetOcrDocumentAsync(explicitDocument.DocumentId, cancellationToken);
            var isStale = exactRow != null && explicitDocument.CurrentVersionId.HasValue
                && !string.Equals(exactRow.VersionId, explicitDocument.CurrentVersionId.Value.ToString(), StringComparison.OrdinalIgnoreCase);
            if ((exactRow == null || isStale) && explicitDocument.CurrentVersionId.HasValue)
            {
                reindexAttempted = true;
                using var reindexCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                reindexCts.CancelAfter(TimeSpan.FromSeconds(60));
                try
                {
                    await ocrIndexService.ReindexAsync(explicitDocument.DocumentId, reindexCts.Token);
                    exactRow = await GetOcrDocumentAsync(explicitDocument.DocumentId, cancellationToken);
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    // Reindexing is still running past our bounded wait; fall through
                    // with whatever we already had (usually null/stale) and tell the
                    // user to ask again shortly instead of blocking indefinitely.
                }
                catch (Exception exception)
                {
                    // Best-effort, same as every other automatic reindex caller
                    // (OcrIndexService.AutoIndexMissingAsync/ReindexBatchJobAsync) —
                    // a MinIO/network failure here must not crash the whole chat
                    // request; degrade to the "ask again shortly" message instead.
                    logger.LogWarning(exception, "On-demand OCR reindex failed for document {DocumentId}", explicitDocument.DocumentId);
                }
            }
            ocrRows = exactRow == null ? [] : [exactRow];
        }
        else if (intent.Documents)
        {
            ocrRows = await SearchOcrAsync(searchTerms, cancellationToken);
        }
        else ocrRows = [];
        var deniedMatch = ocrRows.Any(row => row.DocumentId != null && !accessibleById.ContainsKey(row.DocumentId));
        var asksAboutFile = question.Contains("file", StringComparison.OrdinalIgnoreCase)
            || question.Contains("document", StringComparison.OrdinalIgnoreCase)
            || question.Contains("OCR", StringComparison.OrdinalIgnoreCase)
            || ocrRows.Any(row => !string.IsNullOrWhiteSpace(row.Filename) && question.Contains(row.Filename, StringComparison.OrdinalIgnoreCase));
        var allowedRows = ocrRows
            .Where(row => row.DocumentId != null && accessibleById.ContainsKey(row.DocumentId))
            .GroupBy(row => row.DocumentId, StringComparer.OrdinalIgnoreCase)
            .Select(group => new { Row = group.First(), Score = group.Sum(row => row.Rank ?? 0) })
            .OrderByDescending(item => item.Score)
            .Take(3)
            .Select(item => item.Row)
            .ToList();

        if (explicitDocument != null && allowedRows.Count == 0)
        {
            var noOcrAnswer = !explicitDocument.CurrentVersionId.HasValue
                ? $"I found {explicitDocument.Title}, but it doesn't have a file uploaded yet, so there's no content to search."
                : reindexAttempted
                    ? $"I've started indexing {explicitDocument.Title} — it can take a minute for large files. Please ask again shortly."
                    : $"I found {explicitDocument.Title}, but its OCR/in-file text is not available yet. Ask your system administrator to re-index the file, then try again.";
            return Ok(new { success = true, data = new { answer = noOcrAnswer, accessDenied = false, sources = new[] { new ChatSource("document", explicitDocument.DocumentId.ToString(), explicitDocument.Title) } } });
        }

        // A direct filename/Doc-ID question that only resolves to protected OCR rows
        // must not be softened into a guess from unrelated accessible material.
        if (deniedMatch && allowedRows.Count == 0 && asksAboutFile)
            return Ok(new { success = true, data = new { answer = AccessDeniedAnswer, accessDenied = true, sources = Array.Empty<object>() } });

        var myGroupIds = await context.GroupMembers.AsNoTracking()
            .Where(member => member.UserId == userId)
            .Select(member => member.GroupId)
            .ToListAsync(cancellationToken);
        var tasks = await context.Tasks.AsNoTracking()
            .Where(task => task.AssignedToId == userId || task.ManagerId == userId ||
                (task.AssignedToGroupId.HasValue && myGroupIds.Contains(task.AssignedToGroupId.Value)))
            .OrderBy(task => task.Status == "completed")
            .ThenBy(task => task.DueDate)
            .Take(50)
            .Select(task => new ChatTask(task.TaskId, task.DocumentId, task.Title, task.Description, task.Status, task.RiskSeverity, task.DueDate,
                task.AssignedToId == userId || (task.AssignedToGroupId.HasValue && myGroupIds.Contains(task.AssignedToGroupId.Value)), task.ManagerId == userId))
            .ToListAsync(cancellationToken);

        // Task metadata belongs to the assignee/creator even when its attached file
        // is protected. File title/content is never joined into this task context.
        var safeTasks = tasks;
        var now = DateTime.UtcNow;
        var personalCalendarEvents = await calendarService.TryGetEventsAsync(userId, now.AddDays(-1), now.AddDays(90)) ?? [];
        var auditCalendarRows = await context.AuditCalendarEvents.AsNoTracking()
            .Where(calendarEvent => calendarEvent.EventDate >= DateOnly.FromDateTime(now) && calendarEvent.EventDate <= DateOnly.FromDateTime(now.AddDays(90)))
            .OrderBy(calendarEvent => calendarEvent.EventDate).Take(30)
            .Select(calendarEvent => new { calendarEvent.Title, calendarEvent.EventDate, calendarEvent.Phase, calendarEvent.Standard, calendarEvent.Notes })
            .ToListAsync(cancellationToken);
        var auditCalendarEvents = auditCalendarRows
            .Select(calendarEvent => new ChatCalendarEvent(calendarEvent.Title, calendarEvent.EventDate.ToString("yyyy-MM-dd"), calendarEvent.Phase, calendarEvent.Standard, calendarEvent.Notes, "DMS audit calendar"));
        var calendarEvents = personalCalendarEvents
            .Select(calendarEvent => new ChatCalendarEvent(calendarEvent.Title, calendarEvent.Start.ToString("O"), calendarEvent.Location, null, calendarEvent.Description, "My Google Calendar"))
            .Concat(auditCalendarEvents).ToList();
        var announcements = await context.Announcements.AsNoTracking()
            .OrderByDescending(announcement => announcement.CreatedAt).Take(20)
            .Select(announcement => new ChatAnnouncement(announcement.Title, announcement.Message, announcement.CreatedAt))
            .ToListAsync(cancellationToken);
        var sources = allowedRows
            .Select(row => new ChatSource("document", row.DocumentId!, accessibleById[row.DocumentId!].Title))
            .Concat(explicitDocument == null && intent.Tasks
                ? safeTasks.Take(12).Select(task => new ChatSource("task", task.TaskId.ToString(), task.Title))
                : Enumerable.Empty<ChatSource>())
            .ToList();

        var dashboard = new ChatDashboard(
            safeTasks.Count(task => task.IsAssignedToMe && task.Status != "completed" && task.Status != "done"),
            safeTasks.Count(task => task.IsAssignedToMe && task.DueDate < now && task.Status != "completed" && task.Status != "done"),
            safeTasks.Count(task => task.IsCreatedByMe && task.Status != "completed" && task.Status != "done"),
            accessibleDocuments.Count);
        IEnumerable<ChatTask> contextTasks = explicitDocument == null && intent.Tasks ? safeTasks : Enumerable.Empty<ChatTask>();
        IEnumerable<ChatCalendarEvent> contextCalendar = explicitDocument == null && intent.Calendar ? calendarEvents : Enumerable.Empty<ChatCalendarEvent>();
        IEnumerable<ChatAnnouncement> contextAnnouncements = explicitDocument == null && intent.Announcements ? announcements : Enumerable.Empty<ChatAnnouncement>();
        var includeDashboard = explicitDocument == null && intent.Dashboard;
        List<string> adminInfoLines = canViewAdminInfo ? await BuildAdminInfoLinesAsync(cancellationToken) : [];
        var contextText = BuildContext(question, allowedRows, accessibleById, contextTasks, contextCalendar, contextAnnouncements, dashboard, includeDashboard, adminInfoLines);
        var answer = await GenerateAnswerAsync(question, contextText, recentConversation, prompts.AnswerGenerationPrompt, cancellationToken)
            ?? BuildGroundedFallback(allowedRows, accessibleById, contextTasks, contextCalendar, contextAnnouncements, dashboard, includeDashboard, adminInfoLines);

        if (string.IsNullOrWhiteSpace(answer) && deniedMatch)
            return Ok(new { success = true, data = new { answer = AccessDeniedAnswer, accessDenied = true, sources = Array.Empty<object>() } });
        if (string.IsNullOrWhiteSpace(answer))
            answer = "I couldn't find that in your tasks or in the OCR/in-file content you can access. Try a file name, Doc ID, task title, or a more specific phrase.";

        return Ok(new { success = true, data = new { answer, accessDenied = false, sources } });
    }

    private async Task<List<OcrRow>> SearchOcrAsync(string[] terms, CancellationToken cancellationToken)
    {
        if (terms.Length == 0) return [];
        var client = httpClientFactory.CreateClient("OcrRag");
        var requests = terms.Select(async term =>
        {
            try
            {
                return await client.GetFromJsonAsync<List<OcrRow>>($"api/documents/search?q={Uri.EscapeDataString(term)}", cancellationToken) ?? [];
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
            {
                logger.LogWarning(ex, "OCR search failed for AI chat term");
                return [];
            }
        });
        return (await Task.WhenAll(requests)).SelectMany(rows => rows).ToList();
    }

    private async Task<OcrRow?> GetOcrDocumentAsync(Guid documentId, CancellationToken cancellationToken)
    {
        try
        {
            var client = httpClientFactory.CreateClient("OcrRag");
            return await client.GetFromJsonAsync<OcrRow>($"api/documents/by-document/{documentId}", cancellationToken);
        }
        catch (HttpRequestException exception) when (exception.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(exception, "Exact OCR lookup failed for document {DocumentId}", documentId);
            return null;
        }
    }

    private async Task<string?> GenerateAnswerAsync(string question, string groundedContext, string recentConversation, string systemPrompt, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(groundedContext)) return null;
        var userPrompt = string.IsNullOrWhiteSpace(recentConversation)
            ? $"Question:\n{question}\n\nAuthorized context:\n{groundedContext}"
            : $"Recent conversation:\n{recentConversation}\n\nQuestion:\n{question}\n\nAuthorized context:\n{groundedContext}";
        return await CallAiProviderAsync(systemPrompt, userPrompt, 1200, cancellationToken);
    }

    /// <summary>
    /// One small, cheap LLM call that runs before retrieval — rephrases the raw
    /// question into better full-text search phrases (synonyms, likely alternate
    /// wording — not just its literal words) and decides which context categories
    /// (documents/tasks/calendar/announcements/dashboard) are actually relevant.
    /// Never sees any document content, only the user's own question/history text,
    /// so there is no permission surface here. Returns null (caller falls back to
    /// the keyword heuristics) when no AI provider is configured or the call/parse
    /// fails for any reason — this must never block search-only mode.
    /// </summary>
    // The exact JSON shape AND category classification rules
    // AnalyzeQueryAsync's caller depends on. Kept entirely in code and always
    // appended to whatever prompt text is actually in effect (default or
    // admin-customized) — nothing semantically load-bearing lives only inside
    // the editable prompt. A real gap found live: appending only the JSON
    // *shape* (field names) here wasn't enough — the model still had no
    // instruction for WHEN "adminInfo" should be true, since that guidance
    // lived solely in the editable default prompt text. An admin who opened
    // the new "AI Assistant Prompts" page and saved it even once (without
    // editing anything) before a later category was added to the default
    // would freeze that customized copy on the old rules forever, and
    // rebuilding the containers never touches what's already persisted in
    // dms_app_settings — so this can't be fixed by redeploying alone. The
    // only category classification the editable prompt is still allowed to
    // influence going forward is search-term *phrasing style*, which has no
    // correctness requirement the rest of the code depends on.
    private const string QueryUnderstandingJsonContract =
        " Respond with ONLY a single-line JSON object — no markdown fences, no commentary, no extra text — in exactly this shape: {\"searchTerms\": [\"...\"], \"documents\": true, \"tasks\": false, \"calendar\": false, \"announcements\": false, \"dashboard\": false, \"adminInfo\": false}." +
        " \"documents\": true for a question about a specific file/document's content, a policy, procedure, or anything that would be answered from an uploaded file." +
        " \"tasks\": true for a question about the signed-in user's own assigned or created tasks/PCARs." +
        " \"calendar\": true for a question about meetings, schedules, or audit dates." +
        " \"announcements\": true for a question about posted company announcements." +
        " \"dashboard\": true for a question about the signed-in user's own task/document summary counts." +
        " \"adminInfo\": true for a question about system administration data itself — which users exist, a user's role/status/email, which users belong to a group or team, group/sub-group structure/membership, or what a page-access role can do." +
        " One or more of these six booleans must be true; if none clearly apply, default \"documents\" to true.";

    private async Task<QueryUnderstanding?> AnalyzeQueryAsync(string question, string recentConversation, string systemPrompt, CancellationToken cancellationToken)
    {
        var userPrompt = string.IsNullOrWhiteSpace(recentConversation)
            ? $"Question:\n{question}"
            : $"Recent conversation:\n{recentConversation}\n\nQuestion:\n{question}";
        var raw = await CallAiProviderAsync(systemPrompt + QueryUnderstandingJsonContract, userPrompt, 300, cancellationToken);
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var jsonText = ExtractJsonObject(raw);
        if (jsonText == null) return null;
        try
        {
            using var document = JsonDocument.Parse(jsonText);
            var root = document.RootElement;
            var searchTerms = TryGetPropertyCaseInsensitive(root, "searchTerms", out var termsElement) && termsElement.ValueKind == JsonValueKind.Array
                ? termsElement.EnumerateArray()
                    .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString()?.Trim() : null)
                    .Where(term => !string.IsNullOrWhiteSpace(term))
                    .Select(term => term!)
                    .Take(6)
                    .ToList()
                : new List<string>();
            bool GetBool(string name) => TryGetPropertyCaseInsensitive(root, name, out var element) && element.ValueKind == JsonValueKind.True;
            return new QueryUnderstanding(searchTerms, GetBool("documents"), GetBool("tasks"), GetBool("calendar"), GetBool("announcements"), GetBool("dashboard"), GetBool("adminInfo"));
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Could not parse AI query-understanding response: {Raw}", Limit(raw, 300));
            return null;
        }
    }

    private static string? ExtractJsonObject(string text)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        return start >= 0 && end > start ? text[start..(end + 1)] : null;
    }

    private static bool TryGetPropertyCaseInsensitive(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }
        value = default;
        return false;
    }

    private static ChatIntent NormalizeIntent(QueryUnderstanding understanding)
    {
        var intent = new ChatIntent(understanding.Documents, understanding.Tasks, understanding.Calendar, understanding.Announcements, understanding.Dashboard, understanding.AdminInfo);
        return intent.Documents || intent.Tasks || intent.Calendar || intent.Announcements || intent.Dashboard || intent.AdminInfo
            ? intent
            : intent with { Documents = true };
    }

    private async Task<string?> CallAiProviderAsync(string systemPrompt, string userPrompt, int maxTokens, CancellationToken cancellationToken)
    {
        var settings = await settingsService.LoadAsync();
        foreach (var provider in settingsService.GetEnabledInPriorityOrder(settings))
        {
            try
            {
                var client = httpClientFactory.CreateClient("AiChat");
                object payload;
                if (provider.Provider == AiChatSettingsService.AnthropicProvider)
                {
                    client.DefaultRequestHeaders.Add("x-api-key", provider.ApiKey!);
                    client.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
                    payload = new { model = provider.Model, max_tokens = maxTokens, temperature = 0.1, system = systemPrompt, messages = new[] { new { role = "user", content = userPrompt } } };
                }
                else
                {
                    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", provider.ApiKey);
                    payload = new { model = provider.Model, temperature = 0.1, messages = new object[] { new { role = "system", content = systemPrompt }, new { role = "user", content = userPrompt } } };
                }
                using var response = await client.PostAsJsonAsync(provider.Endpoint, payload, cancellationToken);
                response.EnsureSuccessStatusCode();
                using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
                var answer = provider.Provider == AiChatSettingsService.AnthropicProvider
                    ? json.RootElement.GetProperty("content").EnumerateArray().FirstOrDefault(item => item.GetProperty("type").GetString() == "text").GetProperty("text").GetString()?.Trim()
                    : json.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString()?.Trim();
                if (!string.IsNullOrWhiteSpace(answer)) return answer;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException)
            {
                logger.LogWarning(ex, "AI provider {Provider} failed; trying the next configured provider", provider.Provider);
            }
        }
        return null;
    }

    // Matches a Doc-ID-shaped token like "SWS-25120007" — a short letter prefix,
    // a hyphen, and a run of at least 4 digits. Only used together with an
    // explicit labeling phrase ("Doc ID", "doc no.") so ordinary standard
    // references such as "ISO-9001" don't get misread as an unresolved Doc ID.
    private static readonly Regex DocIdLikeToken = new(@"\b[A-Za-z]{2,10}-\d{4,}\b", RegexOptions.Compiled);

    // An explicit request to stop discussing the currently-active sticky document.
    private static readonly Regex DocumentContextResetPhrase = new(
        @"\b(different (document|file|source)|another (document|file)|change (the )?(source|document|file)|new (document|file|source)|stop (talking about|discussing) (this|that|the) (document|file)|not (about )?(this|that) (document|file)|forget (this|that|the) (document|file)|switch (document|file|source))\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// True when a question clearly asks about something other than a document
    /// (tasks/calendar/announcements/dashboard) with no document-related wording
    /// at all — used to stop the sticky-document default from wrongly forcing an
    /// unrelated question (e.g. "what tasks are assigned to me") onto whatever
    /// document was last discussed.
    /// </summary>
    private static bool LooksLikeNonDocumentTopic(string question)
    {
        bool Has(params string[] values) => values.Any(value => question.Contains(value, StringComparison.OrdinalIgnoreCase));
        if (Has("file", "document", "doc", "ocr", "content", "text", "kpi", "detail", "page", "section", "policy", "procedure", "revision"))
            return false;
        return Has("task", "PCAR", "assigned to me", "created by me", "due date", "overdue",
            "calendar", "meeting", "appointment", "schedule", "audit date", "event",
            "announcement", "notice", "company news",
            "dashboard", "my summary", "my overview")
            || LooksLikeAdminInfoQuestion(question);
    }

    /// <summary>
    /// Whether a question is about system administration data (Users/Groups/
    /// Roles) — deliberately a co-occurrence check ("mentions a group/role-ish
    /// word AND a people-ish word") rather than a fixed phrase list. A real gap
    /// found live: "let me know the IT group users" doesn't match any exact
    /// phrase like "user group" (wrong word order) — natural phrasing varies far
    /// more than a phrase list can enumerate, and this app's own Groups admin
    /// page literally labels group descriptions "IT Team Members", so "team" is
    /// as natural a word here as "group".
    /// </summary>
    private static bool LooksLikeAdminInfoQuestion(string question)
    {
        bool Has(params string[] values) => values.Any(value => question.Contains(value, StringComparison.OrdinalIgnoreCase));
        if (Has("admin panel", "admin info", "system admin", "administrator", "administrators", "all users", "list users", "list of users", "page access role"))
            return true;
        var mentionsGroupOrRole = Has("group", "groups", "team", "teams", "role", "roles");
        var mentionsPeople = Has("user", "users", "member", "members", "who is", "who are", "who's", "list of", "employees", "staff", "people");
        return mentionsGroupOrRole && mentionsPeople;
    }

    /// <summary>
    /// Builds the shared clarification text for any ambiguous-document case
    /// (same-name and word-overlap alike) — every candidate's title, Doc ID, and
    /// full folder path (via the existing audit-log path resolver), so a
    /// same-or-similarly-named document in a different folder is easy to tell
    /// apart without guessing.
    /// </summary>
    private async Task<string> BuildAmbiguousDocumentAnswerAsync(List<ChatDocument> candidates)
    {
        var candidateLines = new List<string>();
        foreach (var candidate in candidates)
        {
            var path = await auditService.ResolveFolderPathAsync(candidate.FolderId);
            candidateLines.Add($"- **{candidate.Title}** (Doc ID: {candidate.OriginalDocumentId ?? "none"}) — {path}");
        }
        return "I found more than one document you can access with that name:\n" + string.Join("\n", candidateLines)
            + "\n\nPlease tell me which one you mean — its Doc ID is the most reliable way.";
    }

    /// <summary>
    /// A looser fallback than <see cref="ResolveExplicitDocument"/>'s full-name
    /// match — finds every accessible document that shares at least one
    /// distinctive word (same stopword-filtered extraction as broad search
    /// terms, so common filler words never count) with the question, even when
    /// neither document's full title/filename appears verbatim. Returns every
    /// matching document regardless of count; the caller only treats it as
    /// ambiguous when more than one comes back — a single shared word with
    /// exactly one document isn't a strong enough signal to resolve on its own.
    /// </summary>
    private static List<ChatDocument> FindWordOverlapCandidates(string text, IEnumerable<ChatDocument> documents)
    {
        var questionWords = ExtractSearchTerms(text).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (questionWords.Count == 0) return [];
        return documents.Where(document => TitleWords(document).Any(questionWords.Contains)).ToList();
    }

    private static IEnumerable<string> TitleWords(ChatDocument document) =>
        string.IsNullOrWhiteSpace(document.FileName)
            ? ExtractSearchTerms(document.Title)
            : ExtractSearchTerms(document.Title).Concat(ExtractSearchTerms(document.FileName));

    private static string NormalizeDocId(string value) => Regex.Replace(value, @"[\s\-\.]", "").ToUpperInvariant();

    /// <summary>
    /// Resolves one specific document a piece of text is "about" — by Doc ID
    /// (tolerant of spacing/hyphen/case differences, matching the normalization
    /// the rest of the DMS already uses for Doc ID search) or by filename/title,
    /// tolerant of punctuation/spacing differences too (a real case: typing
    /// "Backup Process Techniques" for a document actually titled "Backup
    /// Process-Techniques" — without this tolerance, the exact-substring check
    /// silently fails and the question falls through to sticky context instead
    /// of being recognized as the user explicitly naming a document, which can
    /// leave the conversation stuck on whatever document was previously active).
    /// Only ever searches the caller-supplied, already permission-checked
    /// <paramref name="documents"/> list.
    ///
    /// A Doc ID match always wins outright and is never ambiguous — Doc IDs are
    /// enforced unique across the DMS (a case-insensitive database constraint).
    /// A filename/title match has no such guarantee: two accessible documents can
    /// genuinely share the same or a near-identical name (a real case in this
    /// DMS). When more than one matches that way, this deliberately returns no
    /// single answer — the caller must ask the user to disambiguate rather than
    /// silently guessing which document to answer from.
    /// </summary>
    private static ExplicitDocumentMatch ResolveExplicitDocument(string text, IEnumerable<ChatDocument> documents)
    {
        var documentList = documents as IReadOnlyCollection<ChatDocument> ?? documents.ToList();
        var normalizedDocIdText = NormalizeDocId(text);

        var docIdMatch = documentList.FirstOrDefault(document =>
            !string.IsNullOrWhiteSpace(document.OriginalDocumentId) && document.OriginalDocumentId.Length >= 4
            && normalizedDocIdText.Contains(NormalizeDocId(document.OriginalDocumentId)));
        if (docIdMatch != null) return new ExplicitDocumentMatch(docIdMatch, []);

        var normalizedLooseText = NormalizeForLooseMatch(text);
        var nameMatches = documentList
            .Where(document =>
            {
                var normalizedTitle = NormalizeForLooseMatch(document.Title);
                if (normalizedTitle.Length > 0 && normalizedLooseText.Contains(normalizedTitle)) return true;
                if (string.IsNullOrWhiteSpace(document.FileName)) return false;
                var normalizedFileName = NormalizeForLooseMatch(document.FileName);
                return normalizedFileName.Length > 0 && normalizedLooseText.Contains(normalizedFileName);
            })
            .ToList();

        return nameMatches.Count switch
        {
            0 => new ExplicitDocumentMatch(null, []),
            1 => new ExplicitDocumentMatch(nameMatches[0], []),
            _ => new ExplicitDocumentMatch(null, nameMatches),
        };
    }

    // Strips everything but letters/digits down to single spaces and lowercases —
    // makes "Backup Process-Techniques" and "Backup Process/Techniques" (or any
    // other punctuation/casing variant a model's own prose might use) compare
    // equal, since the only thing that matters here is which words were said.
    private static string NormalizeForLooseMatch(string value) => Regex.Replace(value, @"[^A-Za-z0-9]+", " ").Trim().ToLowerInvariant();

    /// <summary>
    /// For resolving a follow-up against recent conversation text — picks
    /// whichever accessible document's filename, title, or Doc ID last appears in
    /// <paramref name="text"/>, not whichever has the longest name. A conversation
    /// can mention several documents; a follow-up always refers to whatever was
    /// discussed most recently, so recency of mention must win over string length.
    /// Title/filename matching tolerates punctuation/spacing differences since the
    /// model's own prose can paraphrase the exact title from one answer to the next.
    /// </summary>
    private static ChatDocument? FindMostRecentlyMentionedDocument(string text, IEnumerable<ChatDocument> documents)
    {
        var documentList = documents as IReadOnlyCollection<ChatDocument> ?? documents.ToList();

        // A Doc ID mention is unambiguous and rare enough to always win outright.
        // Kept on raw text and never mixed with the normalized index space below.
        ChatDocument? bestById = null;
        var bestByIdIndex = -1;
        foreach (var document in documentList)
        {
            if (string.IsNullOrWhiteSpace(document.OriginalDocumentId) || document.OriginalDocumentId.Length < 4) continue;
            var normalizedDocId = NormalizeDocId(document.OriginalDocumentId);
            foreach (Match match in DocIdLikeToken.Matches(text))
            {
                if (match.Index > bestByIdIndex && NormalizeDocId(match.Value) == normalizedDocId)
                {
                    bestByIdIndex = match.Index;
                    bestById = document;
                }
            }
        }
        if (bestById != null) return bestById;

        var normalizedText = NormalizeForLooseMatch(text);
        ChatDocument? best = null;
        var bestIndex = -1;
        foreach (var document in documentList)
        {
            var normalizedTitle = NormalizeForLooseMatch(document.Title);
            var index = normalizedTitle.Length == 0 ? -1 : normalizedText.LastIndexOf(normalizedTitle, StringComparison.Ordinal);
            if (!string.IsNullOrWhiteSpace(document.FileName))
            {
                var normalizedFileName = NormalizeForLooseMatch(document.FileName);
                var fileNameIndex = normalizedFileName.Length == 0 ? -1 : normalizedText.LastIndexOf(normalizedFileName, StringComparison.Ordinal);
                if (fileNameIndex > index) index = fileNameIndex;
            }
            if (index > bestIndex)
            {
                bestIndex = index;
                best = document;
            }
        }
        return best;
    }

    private static IEnumerable<string> ExtractSearchTerms(string question) =>
        question.Split(new[] { ' ', '\t', '\r', '\n', '.', ',', ':', ';', '?', '!', '(', ')', '[', ']', '"', '\'' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word.Trim()).Where(word => word.Length >= 3 && !StopWords.Contains(word)).Distinct(StringComparer.OrdinalIgnoreCase);

    private static ChatIntent DetectIntent(string question)
    {
        bool Has(params string[] values) => values.Any(value => question.Contains(value, StringComparison.OrdinalIgnoreCase));
        var tasks = Has("task", "PCAR", "assigned to me", "created by me", "due date", "overdue");
        var calendar = Has("calendar", "meeting", "appointment", "schedule", "audit date", "event");
        var announcements = Has("announcement", "notice", "company news");
        var dashboard = Has("dashboard", "my summary", "my overview");
        var adminInfo = LooksLikeAdminInfoQuestion(question);
        var documents = Has("file", "document", "OCR", "in-file", "policy", "procedure", "plan", "report", "register", "revision", "doc id", "doc no")
            || Regex.IsMatch(question, @"\.(pdf|docx?|docm|xlsx?|xlsm|pptx?|pptm|txt|csv|png|jpe?g|tiff?)\b", RegexOptions.IgnoreCase)
            || (!tasks && !calendar && !announcements && !dashboard && !adminInfo);
        return new ChatIntent(documents, tasks, calendar, announcements, dashboard, adminInfo);
    }

    private static string BuildRecentConversation(List<AiChatTurn>? history)
    {
        if (history == null || history.Count == 0) return "";
        var lines = history.TakeLast(6)
            .Select(turn => $"{(string.Equals(turn.Role, "assistant", StringComparison.OrdinalIgnoreCase) ? "Assistant" : "User")}: {Limit(turn.Content, 500)}");
        return Limit(string.Join("\n", lines), 2000);
    }

    private static string BuildContext(string question, IEnumerable<OcrRow> rows, IReadOnlyDictionary<string, ChatDocument> documents, IEnumerable<ChatTask> tasks, IEnumerable<ChatCalendarEvent> calendarEvents, IEnumerable<ChatAnnouncement> announcements, ChatDashboard dashboard, bool includeDashboard, IEnumerable<string> adminInfoLines)
    {
        var builder = new StringBuilder();
        foreach (var row in rows)
        {
            var document = documents[row.DocumentId!];
            builder.AppendLine($"DOCUMENT [{document.Title}] (ID {row.DocumentId})\n{ExtractRelevantExcerpt(row.Content, question, 20000)}");
        }
        foreach (var task in tasks)
            builder.AppendLine($"TASK [{task.Title}] Relationship: {(task.IsAssignedToMe ? "assigned to me" : "")} {(task.IsCreatedByMe ? "created by me" : "")}; Status: {task.Status}; Due: {task.DueDate}; Priority: {task.RiskSeverity}; Details: {task.Description}");
        if (includeDashboard)
            builder.AppendLine($"MY DASHBOARD: Open assigned tasks={dashboard.OpenAssignedTasks}; Overdue assigned tasks={dashboard.OverdueAssignedTasks}; Open tasks I created={dashboard.OpenCreatedTasks}; Documents I can access={dashboard.AccessibleDocuments}.");
        foreach (var calendarEvent in calendarEvents)
            builder.AppendLine($"CALENDAR [{calendarEvent.Source}] {calendarEvent.Title}; Date/start: {calendarEvent.Date}; Location/phase: {calendarEvent.LocationOrPhase}; Standard: {calendarEvent.Standard}; Details: {calendarEvent.Details}");
        foreach (var announcement in announcements)
            builder.AppendLine($"ANNOUNCEMENT [{announcement.Title}] Posted: {announcement.CreatedAt:O}; Message: {announcement.Message}");
        foreach (var line in adminInfoLines)
            builder.AppendLine(line);
        return Limit(builder.ToString(), 45000);
    }

    /// <summary>
    /// System administration data (roles, users, groups/sub-groups) for the AI
    /// Assistant's "adminInfo" context category. The caller must have already
    /// confirmed the signed-in user holds a Full Access role before calling this
    /// — it is never filtered per-caller beyond that single blanket check, since
    /// this is exactly what Admin Panel → Users/Groups/Roles already shows any
    /// Full Access user in full.
    /// </summary>
    private async Task<List<string>> BuildAdminInfoLinesAsync(CancellationToken cancellationToken)
    {
        var lines = new List<string>();

        var roles = await context.PageAccessRoles.AsNoTracking()
            .OrderBy(role => role.Role)
            .ToListAsync(cancellationToken);
        foreach (var role in roles)
            lines.Add($"ROLE [{role.Role}] Grants: {DescribeRoleGrants(role)}.");

        var users = await context.Users.AsNoTracking()
            .OrderBy(user => user.FullName)
            .Take(300)
            .Select(user => new { user.FullName, user.Email, user.Role, user.IsActive })
            .ToListAsync(cancellationToken);
        foreach (var user in users)
            lines.Add($"USER [{user.FullName}] Email: {user.Email}; Role: {user.Role ?? "No Access"}; Status: {(user.IsActive ? "Active" : "Inactive")}.");

        var groups = await context.Groups.AsNoTracking()
            .OrderBy(group => group.Name)
            .ToListAsync(cancellationToken);
        var memberRows = await context.GroupMembers.AsNoTracking()
            .Include(member => member.User)
            .Select(member => new { member.GroupId, UserName = member.User!.FullName })
            .ToListAsync(cancellationToken);
        var subgroupRows = await context.GroupSubgroups.AsNoTracking()
            .Include(subgroup => subgroup.ChildGroup)
            .Select(subgroup => new { subgroup.ParentGroupId, ChildName = subgroup.ChildGroup!.Name })
            .ToListAsync(cancellationToken);
        foreach (var group in groups)
        {
            var members = memberRows.Where(member => member.GroupId == group.GroupId).Select(member => member.UserName).ToList();
            var subgroups = subgroupRows.Where(subgroup => subgroup.ParentGroupId == group.GroupId).Select(subgroup => subgroup.ChildName).ToList();
            lines.Add($"GROUP [{group.Name}] Description: {group.Description ?? "(none)"}; Members: {(members.Count > 0 ? string.Join(", ", members) : "none")}; Sub-groups: {(subgroups.Count > 0 ? string.Join(", ", subgroups) : "none")}.");
        }

        return lines;
    }

    // Reflects over every boolean flag on the role (except IsBuiltIn, an
    // internal delete-protection marker, not a real capability) so a newly
    // added permission flag automatically shows up here with no separate list
    // to keep in sync.
    private static string DescribeRoleGrants(DmsPageAccessRole role)
    {
        var grants = typeof(DmsPageAccessRole).GetProperties()
            .Where(property => property.PropertyType == typeof(bool) && property.Name != "IsBuiltIn" && (bool)property.GetValue(role)!)
            .Select(property => Regex.Replace(property.Name, "(?<!^)([A-Z])", " $1").Trim())
            .ToList();
        return grants.Count > 0 ? string.Join(", ", grants) : "no special capabilities";
    }

    // Chunking parameters for ExtractRelevantExcerpt. Overlap exists so a
    // relevant passage sitting right on a chunk boundary still lands whole
    // inside at least one chunk instead of being split across two low scorers.
    private const int ChunkSize = 4000;
    private const int ChunkOverlap = 400;
    private const int MaxChunksPerDocument = 3;

    /// <summary>
    /// A large document's extracted text can easily exceed what's worth sending
    /// in one prompt — but always taking the first N characters silently loses
    /// whatever the actual question is about if it happens to live on, say, page
    /// 15 of a multi-page policy. A single best-guess window has the same problem
    /// one level down: if the real answer is scattered across two sections (one
    /// KPI mentioned on page 3, a related one on page 20), a single window still
    /// only ever catches one of them. This splits the document into overlapping
    /// chunks, scores each by how many times any question keyword (including a
    /// simple singular/plural variant — a table header may say "KPI" where the
    /// question says "KPIs") appears in it, and includes the top few chunks —
    /// in their original document order, not score order, with a gap marker
    /// between non-adjacent ones — instead of just one contiguous window. Falls
    /// back to the plain leading excerpt when no keyword is found anywhere.
    /// </summary>
    private static string ExtractRelevantExcerpt(string content, string question, int maxLength)
    {
        if (content.Length <= maxLength) return content;

        var keywords = ExtractSearchTerms(question).SelectMany(SingularPluralVariants)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (keywords.Length == 0) return Limit(content, maxLength);

        var scoredChunks = ChunkContent(content, ChunkSize, ChunkOverlap)
            .Select(chunk => (chunk.Start, chunk.Text, Score: CountKeywordOccurrences(chunk.Text, keywords)))
            .Where(scored => scored.Score > 0)
            .ToList();
        if (scoredChunks.Count == 0) return Limit(content, maxLength);

        var selected = scoredChunks
            .OrderByDescending(scored => scored.Score)
            .Take(MaxChunksPerDocument)
            .OrderBy(scored => scored.Start)
            .ToList();

        var builder = new StringBuilder();
        var budgetRemaining = maxLength;
        var previousEnd = -1;
        foreach (var chunk in selected)
        {
            if (budgetRemaining <= 0) break;
            if (previousEnd >= 0 && chunk.Start > previousEnd) builder.Append("\n…\n");
            var text = chunk.Text.Length > budgetRemaining ? chunk.Text[..budgetRemaining] : chunk.Text;
            builder.Append(text);
            budgetRemaining -= text.Length;
            previousEnd = chunk.Start + chunk.Text.Length;
        }
        return builder.ToString();
    }

    private static IEnumerable<(int Start, string Text)> ChunkContent(string content, int chunkSize, int overlap)
    {
        var start = 0;
        while (start < content.Length)
        {
            var length = Math.Min(chunkSize, content.Length - start);
            yield return (start, content.Substring(start, length));
            if (start + length >= content.Length) yield break;
            start += chunkSize - overlap;
        }
    }

    private static int CountKeywordOccurrences(string text, string[] keywords)
    {
        var count = 0;
        foreach (var keyword in keywords)
        {
            var index = 0;
            while ((index = text.IndexOf(keyword, index, StringComparison.OrdinalIgnoreCase)) >= 0)
            {
                count++;
                index += keyword.Length;
            }
        }
        return count;
    }

    private static IEnumerable<string> SingularPluralVariants(string keyword)
    {
        yield return keyword;
        yield return keyword.Length > 3 && keyword.EndsWith("s", StringComparison.OrdinalIgnoreCase)
            ? keyword[..^1]
            : keyword + "s";
    }

    private static string BuildGroundedFallback(IEnumerable<OcrRow> rows, IReadOnlyDictionary<string, ChatDocument> documents, IEnumerable<ChatTask> tasks, IEnumerable<ChatCalendarEvent> calendarEvents, IEnumerable<ChatAnnouncement> announcements, ChatDashboard dashboard, bool includeDashboard, IEnumerable<string> adminInfoLines)
    {
        var taskList = tasks.ToList();
        var rowList = rows.ToList();
        var adminInfoList = adminInfoLines.ToList();
        var parts = new List<string>();
        if (includeDashboard)
            parts.Add($"Your dashboard summary:\n- Open assigned tasks: {dashboard.OpenAssignedTasks}\n- Overdue assigned tasks: {dashboard.OverdueAssignedTasks}\n- Open tasks you created: {dashboard.OpenCreatedTasks}\n- Accessible documents: {dashboard.AccessibleDocuments}");
        if (taskList.Count > 0)
            parts.Add("Your relevant tasks:\n" + string.Join("\n", taskList.Select(task => $"• {task.Title} — {task.Status}{(task.DueDate == null ? "" : $", due {task.DueDate:yyyy-MM-dd}")}")));
        if (rowList.Count > 0)
        {
            var row = rowList[0];
            parts.Add($"AI answering is currently unavailable, but I found this authorized source: **{documents[row.DocumentId!].Title}**.\n\nSearch excerpt:\n{CleanOcrExcerpt(row.Content)}");
        }
        if (calendarEvents.Any())
            parts.Add("Upcoming calendar items:\n" + string.Join("\n", calendarEvents.Take(5).Select(item => $"• {item.Title} — {item.Date}")));
        if (announcements.Any())
            parts.Add("Latest announcements:\n" + string.Join("\n", announcements.Take(3).Select(item => $"• {item.Title}: {Limit(item.Message, 200)}")));
        if (adminInfoList.Count > 0)
            parts.Add("Admin info:\n" + string.Join("\n", adminInfoList.Take(30).Select(line => $"• {line}")));
        return string.Join("\n\n", parts);
    }

    private static string CleanOcrExcerpt(string value)
    {
        var text = Regex.Replace(value, @"<!--\s*image\s*-->", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"&#x20;|&nbsp;", " ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\n{3,}", "\n\n").Trim();
        return Limit(text, 900);
    }

    private static string Limit(string? value, int length) => string.IsNullOrWhiteSpace(value) ? "" : value.Length <= length ? value : value[..length] + "…";
    private sealed record ChatDocument(Guid DocumentId, Guid FolderId, string Title, string? FileName, string? OriginalDocumentId, string? Description, string Status, Guid? CurrentVersionId);
    private sealed record ExplicitDocumentMatch(ChatDocument? Document, List<ChatDocument> AmbiguousCandidates);
    private sealed record ChatTask(Guid TaskId, Guid? DocumentId, string Title, string? Description, string Status, string? RiskSeverity, DateTime? DueDate, bool IsAssignedToMe, bool IsCreatedByMe);
    private sealed record ChatCalendarEvent(string Title, string Date, string? LocationOrPhase, string? Standard, string? Details, string Source);
    private sealed record ChatAnnouncement(string Title, string Message, DateTime CreatedAt);
    private sealed record ChatDashboard(int OpenAssignedTasks, int OverdueAssignedTasks, int OpenCreatedTasks, int AccessibleDocuments);
    private sealed record ChatSource(string Type, string Id, string Title);
    private sealed record ChatIntent(bool Documents, bool Tasks, bool Calendar, bool Announcements, bool Dashboard, bool AdminInfo);
    private sealed record QueryUnderstanding(List<string> SearchTerms, bool Documents, bool Tasks, bool Calendar, bool Announcements, bool Dashboard, bool AdminInfo);
    private sealed record OcrRow(
        int Id,
        [property: System.Text.Json.Serialization.JsonPropertyName("document_id")] string? DocumentId,
        [property: System.Text.Json.Serialization.JsonPropertyName("version_id")] string? VersionId,
        string Filename,
        string Content,
        double? Rank);
}

public record AiChatTurn(string Role, string Content);
public record AiChatRequest(string Message, List<AiChatTurn>? History = null);
