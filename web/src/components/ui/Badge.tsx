import { forwardRef, ReactNode } from 'react';

type BadgeStatus = 'success' | 'warning' | 'error' | 'info' | 'default';
type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: BadgeStatus;
  size?: BadgeSize;
  variant?: 'solid' | 'outline';
  children: ReactNode;
}

const statusClasses: Record<BadgeStatus, { solid: string; outline: string }> = {
  success: {
    solid: 'bg-emerald-600 text-white shadow-sm hover:shadow-md hover:bg-emerald-700 transition-all',
    outline: 'border border-emerald-500 text-emerald-700 dark:text-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
  },
  warning: {
    solid: 'bg-amber-600 text-white shadow-sm hover:shadow-md hover:bg-amber-700 transition-all',
    outline: 'border border-amber-500 text-amber-700 dark:text-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30',
  },
  error: {
    solid: 'bg-red-600 text-white shadow-sm hover:shadow-md hover:bg-red-700 transition-all',
    outline: 'border border-red-500 text-red-700 dark:text-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/30',
  },
  info: {
    solid: 'bg-blue-600 text-white shadow-sm hover:shadow-md hover:bg-blue-700 transition-all',
    outline: 'border border-blue-500 text-blue-700 dark:text-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30',
  },
  default: {
    solid: 'bg-gray-600 text-white shadow-sm hover:shadow-md hover:bg-gray-700 transition-all',
    outline: 'border border-gray-400 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-950/30',
  },
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-2.5 py-1 text-xs font-semibold',
  md: 'px-3.5 py-1.5 text-sm font-semibold',
  lg: 'px-4.5 py-2 text-base font-semibold',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({
    status = 'default',
    size = 'md',
    variant = 'solid',
    className = '',
    ...props
  }, ref) => (
    <span
      ref={ref}
      className={`
        inline-flex items-center justify-center whitespace-nowrap rounded-lg
        ${statusClasses[status][variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      {...props}
    />
  )
);

Badge.displayName = 'Badge';
