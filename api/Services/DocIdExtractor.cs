using System.Text.RegularExpressions;

namespace DMS.Api.Services;

// Scans a document's already-extracted text (from the existing Docling/OCR
// pipeline the frontend runs on every upload) for a "Doc ID" / "Doc No" /
// "Document ID" style label and pulls out the value that follows it.
// Examples: "Doc No.: SWS-13100002", "Document ID: QM-2026-0042"
public static partial class DocIdExtractor
{
    // Pattern: matches "Doc No.:", "Document ID:", etc. followed by the ID value
    // Captures IDs like SWS-13100002, QM-2026-0042, ABC-123
    [GeneratedRegex(
        @"(?:doc(?:ument)?\s*(?:no|id)\s*[:\.\-]?\s*)([A-Za-z0-9\-\.]+)",
        RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex DocIdPattern();

    public static string? Extract(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var match = DocIdPattern().Match(text);
        if (!match.Success)
            return null;

        var extracted = match.Groups[1].Value.Trim();
        // Remove trailing punctuation except dashes (which are part of doc IDs)
        extracted = Regex.Replace(extracted, @"[\s\.\,\:\;]+$", "");

        // Ensure extracted ID is not empty and has meaningful length (3+ chars)
        return !string.IsNullOrWhiteSpace(extracted) && extracted.Length >= 3 ? extracted : null;
    }
}
