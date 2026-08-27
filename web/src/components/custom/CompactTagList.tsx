const VISIBLE_RECENT_TAGS = 2;

interface CompactTagListProps {
  tags: string[];
}

/** Shows the newest tags inline and exposes the complete list from the remainder badge. */
export function CompactTagList({ tags }: CompactTagListProps) {
  if (!tags.length) return <span className="text-[#93a4bd]">—</span>;

  const recentTags = tags.slice(-VISIBLE_RECENT_TAGS).reverse();
  const remainingCount = Math.max(0, tags.length - recentTags.length);
  const allTags = tags.join(', ');

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {recentTags.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="max-w-full truncate rounded-full bg-[#edf2f8] px-2 py-0.5 text-xs font-medium text-[#52627a] dark:bg-slate-800 dark:text-slate-200"
          title={tag}
        >
          {tag}
        </span>
      ))}
      {remainingCount > 0 && (
        <span
          tabIndex={0}
          className="rounded-full bg-[#dfe7f1] px-2 py-0.5 text-xs font-semibold text-[#40516b] hover:bg-[#d3deeb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] dark:bg-slate-700 dark:text-slate-100"
          aria-label={`${remainingCount} more tag${remainingCount === 1 ? '' : 's'}. All tags: ${allTags}`}
          title={`All tags: ${allTags}`}
        >
          +{remainingCount}
        </span>
      )}
    </div>
  );
}
