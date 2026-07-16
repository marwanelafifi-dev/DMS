export function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-12 bg-navy-600 dark:bg-navy-600 rounded-lg animate-skeleton" />
      <div className="space-y-2">
        <div className="h-4 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton w-3/4" />
        <div className="h-4 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonLoader() {
  return <Skeleton />;
}

export function SkeletonCard() {
  return (
    <div className="bg-navy-700 dark:bg-navy-700 rounded-lg p-6 space-y-4">
      <div className="h-6 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton w-1/3" />
      <div className="space-y-2">
        <div className="h-4 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton" />
        <div className="h-4 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton w-5/6" />
      </div>
    </div>
  );
}

export function SkeletonTable() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4 p-4 bg-navy-700 dark:bg-navy-700 rounded-lg">
          <div className="h-4 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton flex-1" />
          <div className="h-4 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton flex-1" />
          <div className="h-4 bg-navy-600 dark:bg-navy-600 rounded animate-skeleton flex-1" />
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
    <div className={`${sizeClass} border-4 border-navy-600 dark:border-navy-600 border-t-cyan-600 rounded-full animate-spin`} />
  );
}
