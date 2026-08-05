// A user's global role (see api/Models/DmsPageAccessRole.cs) is page/feature
// access only — User, Manager, Quality, Auditor, Full Access — and those
// names are already the display labels, so this is now just a pass-through.
// Kept as a function (not used directly) so call sites don't need to change
// if a future custom role ever wants a friendlier display name.
export const roleLabel = (role: string): string => role;
