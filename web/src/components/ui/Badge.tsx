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
    solid: 'bg-success text-white shadow-md',
    outline: 'border-2 border-success text-success dark:text-success',
  },
  warning: {
    solid: 'bg-warning text-slate-900 shadow-md',
    outline: 'border-2 border-warning text-warning dark:text-warning',
  },
  error: {
    solid: 'bg-error text-white shadow-md',
    outline: 'border-2 border-error text-error dark:text-error',
  },
  info: {
    solid: 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md',
    outline: 'border-2 border-primary-500 text-primary-600 dark:text-primary-400 dark:border-primary-400',
  },
  default: {
    solid: 'bg-slate-200 dark:bg-navy-700 text-navy-900 dark:text-primary-200 shadow-md',
    outline: 'border-2 border-slate-300 dark:border-navy-600 text-navy-900 dark:text-primary-300',
  },
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
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
        inline-flex items-center font-semibold rounded-lg
        ${statusClasses[status][variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      {...props}
    />
  )
);

Badge.displayName = 'Badge';
