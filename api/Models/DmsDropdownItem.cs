namespace DMS.Api.Models;

// A single manageable entry in an admin-editable dropdown list (Department,
// Category, Tags, ...) shown on the Company Data admin page. ListKey groups
// items into their list — see DropdownListKeys for the canonical set.
public class DmsDropdownItem
{
    public Guid ItemId { get; set; }
    public string ListKey { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
}

// The dropdown lists Company Data currently manages. Adding a new list here
// means adding a matching entry to DROPDOWN_LIST_DEFS on the frontend too.
public static class DropdownListKeys
{
    public const string Department = "department";
    public const string Category = "category";
    public const string Tag = "tag";

    public static readonly string[] All = [Department, Category, Tag];
    public static bool IsValid(string key) => All.Contains(key);
}
