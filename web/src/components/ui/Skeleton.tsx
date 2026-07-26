export function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-12 bg-gray-200 dark:bg-navy-800 rounded-lg animate-skeleton" />
      <div className="space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton w-3/4" />
        <div className="h-4 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonLoader() {
  return <Skeleton />;
}

export function SkeletonCard() {
  return (
    <div className="bg-gray-100 dark:bg-navy-900 rounded-lg p-6 space-y-4">
      <div className="h-6 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton w-1/3" />
      <div className="space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton" />
        <div className="h-4 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton w-5/6" />
      </div>
    </div>
  );
}

export function SkeletonTable() {
  return (
    <div className="min-w-0 space-y-2 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex min-w-0 gap-4 rounded-lg bg-gray-100 p-4 dark:bg-navy-900">
          <div className="h-4 min-w-0 flex-1 animate-skeleton rounded bg-gray-200 dark:bg-navy-800" />
          <div className="h-4 min-w-0 flex-1 animate-skeleton rounded bg-gray-200 dark:bg-navy-800" />
          <div className="h-4 min-w-0 flex-1 animate-skeleton rounded bg-gray-200 dark:bg-navy-800" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
  }[size];

  return (
    <div className={`${sizeClass} border-4 border-gray-200 dark:border-navy-700 border-t-blue-600 dark:border-t-cyan-500 rounded-full animate-spin`} />
  );
}
