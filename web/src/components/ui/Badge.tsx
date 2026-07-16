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
    solid: 'bg-cyan-600 text-white shadow-md',
    outline: 'border-2 border-cyan-600 text-cyan-600 dark:text-cyan-400 dark:border-cyan-400',
  },
  warning: {
    solid: 'bg-navy-600 text-white shadow-md',
    outline: 'border-2 border-navy-600 text-navy-600 dark:text-navy-300 dark:border-navy-400',
  },
  error: {
    solid: 'bg-navy-700 text-white shadow-md',
    outline: 'border-2 border-navy-700 text-navy-700 dark:text-navy-300 dark:border-navy-500',
  },
  info: {
    solid: 'bg-cyan-600 text-white shadow-md',
    outline: 'border-2 border-cyan-600 text-cyan-600 dark:text-cyan-400 dark:border-cyan-400',
  },
  default: {
    solid: 'bg-navy-600 dark:bg-navy-600 text-white shadow-md',
    outline: 'border-2 border-navy-600 dark:border-navy-600 text-navy-700 dark:text-navy-300',
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
