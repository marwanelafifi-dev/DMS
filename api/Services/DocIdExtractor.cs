using System.Text.RegularExpressions;

namespace DMS.Api.Services;

// Scans a document's already-extracted text (from the existing Docling/OCR
// pipeline the frontend runs on every upload) for a "Doc ID" / "Doc No" /
// "Document ID" style label and pulls out the value that follows it.
// Examples: "Doc No.: SWS-13100002", "Document ID: QM-2026-0042"
public static partial class DocIdExtractor
{
    // Pattern: matches "Doc No.:", "Document ID:", etc. followed by the ID value.
    // Docling exports tables as Markdown (e.g. "| Doc No.: | SWS-13100002 |"), so the
    // label and value are often separated by a "|" cell divider and/or multiple
    // punctuation characters (".:") rather than a single colon — the separator here
    // allows any mix of punctuation, whitespace, and "|" between the two.
    // Captures IDs like SWS-13100002, QM-2026-0042, ABC-123
    //
    // Also matches a bare "ID :" label with no "Doc"/"Document" prefix (e.g. a plain
    // "ID : SWS-1000001" line) — but only when followed immediately by ":" or "|"
    // (not just whitespace), so a stray word "id" in ordinary prose can't misfire.
    [GeneratedRegex(
        @"(?:doc(?:ument)?\.?\s*(?:no|id)\.?\s*[:\-\|\s]*|\bid\b\s*[:\|]\s*)([A-Za-z0-9][A-Za-z0-9\-\./]{2,40})",
        RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex DocIdPattern();

    // Docling renders emphasized table headers/labels as Markdown ("**Doc No.:**"),
    // which otherwise breaks the label match right after "doc".
    [GeneratedRegex(@"[*_`]")]
    private static partial Regex MarkdownEmphasisPattern();

    public static string? Extract(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var cleaned = MarkdownEmphasisPattern().Replace(text, "");
        var match = DocIdPattern().Match(cleaned);
        if (!match.Success)
            return null;

        var extracted = match.Groups[1].Value.Trim();
        // Remove trailing punctuation except dashes (which are part of doc IDs)
        extracted = Regex.Replace(extracted, @"[\s\.\,\:\;]+$", "");

        // Ensure extracted ID is not empty and has meaningful length (3+ chars)
        return !string.IsNullOrWhiteSpace(extracted) && extracted.Length >= 3 ? extracted : null;
    }
}
