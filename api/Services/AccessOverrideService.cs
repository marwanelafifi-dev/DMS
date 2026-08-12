using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// Resolves File/Folder Permission overrides on top of the role-based system.
// A folder-scoped override cascades to every subfolder and document beneath
// it; a document-scoped override applies only to that exact file.
//
// Resolution order:
//   1. A direct (User-target, matching the caller) override with an explicit
//      decision for this action wins outright — allow or deny — regardless
//      of any group-level override. Specificity beats breadth.
//   2. Otherwise, among the caller's group-level overrides: deny always wins
//      if any group denies; an allow wins if none deny.
//   3. With no applicable override at all, the role's own default stands.
public class AccessOverrideService(DmsContext context)
{
    private static readonly Func<DmsAccessOverride, bool?> NoSelector = _ => null;

    private static Func<DmsAccessOverride, bool?> SelectorFor(string action) => action switch
    {
        AccessOverrideActions.Read => o => o.Read,
        AccessOverrideActions.Write => o => o.Write,
        AccessOverrideActions.Rename => o => o.Rename,
        AccessOverrideActions.Copy => o => o.Copy,
        AccessOverrideActions.Cut => o => o.Cut,
        AccessOverrideActions.DownloadZip => o => o.DownloadZip,
        AccessOverrideActions.CreateSubfolder => o => o.CreateSubfolder,
        AccessOverrideActions.Delete => o => o.Delete,
        // Real gap found live: a folder-scoped override that grants Folder
        // Level "Read" (Allow) made the folder — and the files listed inside
        // it — show up, but doing nothing about the separate File Level
        // "Read" flag meant those files still couldn't actually be opened;
        // an admin had to remember to also flip the File Level "Read" toggle
        // in the same modal for the same person just to let them view what
        // they could already see was there. A folder-scoped row's own
        // explicit FileRead decision (Allow or Deny) still wins outright when
        // set — this only fills in when that row left FileRead on Inherit.
        AccessOverrideActions.FileRead => o => o.FileRead ?? (o.FolderId.HasValue ? o.Read : null),
        AccessOverrideActions.FileRename => o => o.FileRename,
        AccessOverrideActions.FileCopy => o => o.FileCopy,
        AccessOverrideActions.FileCut => o => o.FileCut,
        AccessOverrideActions.Unlock => o => o.Unlock,
        AccessOverrideActions.SubmitForApproval => o => o.SubmitForApproval,
        // Real gap found live, right after fixing FileRead above: this app has
        // no separate "stream for in-browser preview" route — the Document
        // Library's "View" (eye icon) fetches the exact same
        // GET .../versions/{id}/download bytes as the "Download" button, just
        // renders them inline instead of saving to disk. So granting FileRead
        // (View) alone still left the actual preview 403ing on this action,
        // since Download was never touched by the FileRead fallback above —
        // a user could be told "yes you can view this" and then have viewing
        // itself fail. Falls back through FileRead, then folder Read, same
        // "more specific explicit decision always wins" rule as above.
        AccessOverrideActions.Download => o => o.Download ?? o.FileRead ?? (o.FolderId.HasValue ? o.Read : null),
        AccessOverrideActions.DownloadForEditing => o => o.DownloadForEditing,
        AccessOverrideActions.UploadUpdatedFile => o => o.UploadUpdatedFile,
        AccessOverrideActions.FileDelete => o => o.FileDelete,
        AccessOverrideActions.FileEdit => o => o.FileEdit,
        AccessOverrideActions.ManagePermissions => o => o.ManagePermissions,
        AccessOverrideActions.FileManagePermissions => o => o.FileManagePermissions,
        AccessOverrideActions.ViewHistory => o => o.ViewHistory,
        AccessOverrideActions.ViewRelatedTasks => o => o.ViewRelatedTasks,
        _ => NoSelector
    };

    // Returns the final allow/deny decision for `action`, folding in the
    // role's default (`roleAllows`) with any applicable override.
    public async Task<bool> ResolveAsync(Guid userId, Guid? documentId, Guid? folderId, string action, bool roleAllows)
    {
        var (direct, group) = await GetApplicableOverridesAsync(userId, documentId, folderId);
        var selector = SelectorFor(action);

        var directDecisions = direct.Select(selector).Where(d => d.HasValue).Select(d => d!.Value).ToList();
        if (directDecisions.Count > 0)
            return !directDecisions.Contains(false); // direct deny anywhere beats direct allow; no group input needed

        var groupDecisions = group.Select(selector).Where(d => d.HasValue).Select(d => d!.Value).ToList();
        if (groupDecisions.Count == 0)
            return roleAllows;

        return !groupDecisions.Contains(false);
    }

    // Used by folder/document *list* endpoints alongside per-folder grants —
    // a Read-allow override can grant visibility into a folder (and
    // everything beneath it) even with no folder-role grant at all, which is
    // the whole point of "managed by each folder permission using users or
    // groups". Direct overrides still beat group ones for visibility, same
    // as ResolveAsync.
    public async Task<HashSet<Guid>> GetOverrideVisibleFolderIdsAsync(Guid userId)
    {
        var groupIds = await context.GroupMembers
            .Where(gm => gm.UserId == userId)
            .Select(gm => gm.GroupId)
            .ToListAsync();

        var myOverrides = await context.AccessOverrides
            .Where(o => (o.TargetType == "User" && o.TargetId == userId) || (o.TargetType == "Group" && groupIds.Contains(o.TargetId)))
            .ToListAsync();

        var allFolders = await context.Folders.AsNoTracking().Select(f => new { f.FolderId, f.ParentFolderId }).ToListAsync();
        var childrenByParent = allFolders
            .Where(f => f.ParentFolderId.HasValue)
            .GroupBy(f => f.ParentFolderId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(f => f.FolderId).ToList());

        var visible = new HashSet<Guid>();

        foreach (var o in myOverrides.Where(o => o.FolderId.HasValue && o.Read == true))
        {
            // Cascade downward — every descendant of an allowed folder is
            // visible too, unless a direct-beats-group-resolved deny sits
            // further down (approximated here as "any applicable deny at
            // that folder", since this is a coarse visibility pass, not the
            // fine per-action ResolveAsync check).
            var queue = new Queue<Guid>();
            queue.Enqueue(o.FolderId!.Value);
            var guard = 0;
            while (queue.Count > 0 && guard++ < 5000)
            {
                var current = queue.Dequeue();
                var directDeny = myOverrides.Any(d => d.FolderId == current && d.TargetType == "User" && d.Read == false);
                var directAllow = myOverrides.Any(d => d.FolderId == current && d.TargetType == "User" && d.Read == true);
                var groupDeny = myOverrides.Any(d => d.FolderId == current && d.TargetType == "Group" && d.Read == false);
                var deniedHere = directDeny || (!directAllow && groupDeny);
                if (deniedHere && current != o.FolderId!.Value)
                    continue;

                visible.Add(current);
                if (childrenByParent.TryGetValue(current, out var children))
                    foreach (var child in children)
                        queue.Enqueue(child);
            }
        }

        foreach (var o in myOverrides.Where(o => o.DocumentId.HasValue && o.FileRead == true))
        {
            var folderId = await context.Documents.Where(d => d.DocumentId == o.DocumentId).Select(d => (Guid?)d.FolderId).FirstOrDefaultAsync();
            if (folderId.HasValue)
                visible.Add(folderId.Value);
        }

        return visible;
    }

    // Splits the overrides applicable to this user/resource into direct
    // (User-target matching the caller) and group-level (Group-target for
    // any group the caller belongs to) — see ResolveAsync for why the split
    // matters. Applicable means: on the exact document (if given), or on the
    // document's folder plus every ancestor folder up to the root (cascading).
    private async Task<(List<DmsAccessOverride> Direct, List<DmsAccessOverride> Group)> GetApplicableOverridesAsync(Guid userId, Guid? documentId, Guid? folderId)
    {
        Guid? effectiveFolderId = folderId;
        if (documentId.HasValue && !effectiveFolderId.HasValue)
        {
            effectiveFolderId = await context.Documents
                .Where(d => d.DocumentId == documentId)
                .Select(d => (Guid?)d.FolderId)
                .FirstOrDefaultAsync();
        }

        var folderChain = new List<Guid>();
        var currentFolderId = effectiveFolderId;
        var guard = 0; // defends against an accidental cycle in parent_folder_id
        while (currentFolderId.HasValue && guard++ < 50)
        {
            folderChain.Add(currentFolderId.Value);
            currentFolderId = await context.Folders
                .Where(f => f.FolderId == currentFolderId)
                .Select(f => f.ParentFolderId)
                .FirstOrDefaultAsync();
        }

        var groupIds = await context.GroupMembers
            .Where(gm => gm.UserId == userId)
            .Select(gm => gm.GroupId)
            .ToListAsync();

        var candidates = await context.AccessOverrides
            .Where(o =>
                (documentId.HasValue && o.DocumentId == documentId) ||
                (o.FolderId.HasValue && folderChain.Contains(o.FolderId.Value)))
            .ToListAsync();

        var direct = candidates.Where(o => o.TargetType == "User" && o.TargetId == userId).ToList();
        var group = candidates.Where(o => o.TargetType == "Group" && groupIds.Contains(o.TargetId)).ToList();
        return (direct, group);
    }
}
