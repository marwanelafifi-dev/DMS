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
    solid: 'bg-success text-white',
    outline: 'border border-success text-success',
  },
  warning: {
    solid: 'bg-warning text-gray-900',
    outline: 'border border-warning text-warning',
  },
  error: {
    solid: 'bg-error text-white',
    outline: 'border border-error text-error',
  },
  info: {
    solid: 'bg-info text-white',
    outline: 'border border-info text-info',
  },
  default: {
    solid: 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100',
    outline: 'border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100',
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
        inline-flex items-center font-medium rounded-full
        ${statusClasses[status][variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      {...props}
    />
  )
);

Badge.displayName = 'Badge';
