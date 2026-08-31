using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Admin-editable system prompts for the AI Assistant — same "Full Access acts
// as admin everywhere" gate as ApiKeysController, since this shapes exactly
// what the model is instructed to do with every user's authorized context.
[ApiController]
[Route("api/ai-chat-prompts")]
public class AiChatPromptsController(DmsContext context, AiChatPromptsService promptsService, AuditService auditService) : BaseController
{
    private async Task<bool> IsAdminAsync() => (await GetPageAccessRoleAsync(context, GetCurrentUserId()))?.BypassFolderPermissions == true;

    [HttpGet]
    public async Task<ActionResult<object>> GetPrompts()
    {
        if (!await IsAdminAsync()) return Forbidden();
        var prompts = await promptsService.LoadAsync();
        return Ok(new { success = true, data = new
        {
            prompts.AnswerGenerationPrompt, prompts.QueryUnderstandingPrompt, prompts.UpdatedAt,
            defaultAnswerGenerationPrompt = AiChatPromptsService.DefaultAnswerGenerationPrompt,
            defaultQueryUnderstandingPrompt = AiChatPromptsService.DefaultQueryUnderstandingPrompt,
        } });
    }

    [HttpPut]
    public async Task<ActionResult<object>> Update([FromBody] UpdateAiChatPromptsRequest request)
    {
        if (!await IsAdminAsync()) return Forbidden();
        if (request.AnswerGenerationPrompt?.Length > 8000 || request.QueryUnderstandingPrompt?.Length > 8000)
            return BadRequest(new { success = false, error = "A prompt is too long (8,000 character limit)." });

        var saved = await promptsService.SaveAsync(request.AnswerGenerationPrompt, request.QueryUnderstandingPrompt, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new
        {
            Group = "ai_chat_prompts",
            AnswerGenerationPromptCustomized = !string.IsNullOrWhiteSpace(request.AnswerGenerationPrompt),
            QueryUnderstandingPromptCustomized = !string.IsNullOrWhiteSpace(request.QueryUnderstandingPrompt),
        });
        return Ok(new { success = true, data = new
        {
            saved.AnswerGenerationPrompt, saved.QueryUnderstandingPrompt, saved.UpdatedAt,
            defaultAnswerGenerationPrompt = AiChatPromptsService.DefaultAnswerGenerationPrompt,
            defaultQueryUnderstandingPrompt = AiChatPromptsService.DefaultQueryUnderstandingPrompt,
        } });
    }

    private ObjectResult Forbidden() => StatusCode(403, new { success = false, error = "Only a Full Access role can manage AI assistant prompts." });
}

public record UpdateAiChatPromptsRequest(string? AnswerGenerationPrompt, string? QueryUnderstandingPrompt);
