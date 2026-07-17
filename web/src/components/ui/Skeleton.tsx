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
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4 p-4 bg-gray-100 dark:bg-navy-900 rounded-lg">
          <div className="h-4 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton flex-1" />
          <div className="h-4 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton flex-1" />
          <div className="h-4 bg-gray-200 dark:bg-navy-800 rounded animate-skeleton flex-1" />
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
