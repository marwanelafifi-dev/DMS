using System.Text;

namespace DMS.Api.Services;

// Minimal, dependency-free RFC4180-style CSV parser. Written by hand rather
// than adding a NuGet package (CsvHelper etc.) for what's a genuinely small
// amount of parsing logic — same call this codebase already made for the
// KnowledgeTree migration's hand-rolled mysqldump parser (see
// migration/scripts/extract_legacy_metadata.py).
//
// The naive "split on comma" approach used elsewhere (DropdownListsController's
// single-column import) breaks the moment a cell is quoted and contains its
// own commas — e.g. a Groups export's Members column: "a@x.com, b@x.com".
// This handles quoted fields (including an escaped "" for a literal quote
// inside one) properly.
public static class CsvParser
{
    public static List<List<string>> ParseRows(string csvText)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        void EndField()
        {
            row.Add(field.ToString());
            field.Clear();
        }

        void EndRow()
        {
            EndField();
            rows.Add(row);
            row = new List<string>();
        }

        for (var i = 0; i < csvText.Length; i++)
        {
            var c = csvText[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < csvText.Length && csvText[i + 1] == '"')
                    {
                        field.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    field.Append(c);
                }
                continue;
            }

            switch (c)
            {
                case '"':
                    inQuotes = true;
                    break;
                case ',':
                    EndField();
                    break;
                case '\r':
                    break; // \n (below) ends the row either way
                case '\n':
                    EndRow();
                    break;
                default:
                    field.Append(c);
                    break;
            }
        }
        // Last row if the file doesn't end with a trailing newline.
        if (field.Length > 0 || row.Count > 0) EndRow();

        // Drop fully-blank rows (trailing newline, stray empty lines).
        return rows.Where(r => r.Any(f => !string.IsNullOrWhiteSpace(f))).ToList();
    }

    // Parses the full CSV as a header row + data rows, returning each data row
    // as a dictionary keyed by the trimmed header name (case-insensitive
    // lookup, so "Email"/"email"/"EMAIL" all resolve the same column).
    public static List<Dictionary<string, string>> ParseWithHeader(string csvText)
    {
        var rows = ParseRows(csvText);
        if (rows.Count == 0) return [];

        var headers = rows[0].Select(h => h.Trim()).ToList();
        var result = new List<Dictionary<string, string>>();
        for (var r = 1; r < rows.Count; r++)
        {
            var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var c = 0; c < headers.Count; c++)
                dict[headers[c]] = c < rows[r].Count ? rows[r][c].Trim() : string.Empty;
            result.Add(dict);
        }
        return result;
    }

    public static string GetValue(this Dictionary<string, string> row, string key) =>
        row.TryGetValue(key, out var value) ? value : string.Empty;

    // Splits a single cell's comma-separated list (e.g. a Members or Sub
    // Groups column), trimming each entry and dropping empties.
    public static List<string> SplitList(string cellValue) =>
        cellValue.Split(',')
            .Select(v => v.Trim())
            .Where(v => v.Length > 0)
            .ToList();
}
