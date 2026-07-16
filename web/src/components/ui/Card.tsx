import { forwardRef, ReactNode } from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`
        bg-navy-700 dark:bg-navy-700 border border-navy-600 dark:border-navy-600
        rounded-xl shadow-lg hover:shadow-2xl dark:shadow-2xl transition-all duration-normal
        ${className}
      `}
      {...props}
    />
  )
);

Card.displayName = 'Card';

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`px-6 py-4 border-b border-navy-600 dark:border-navy-600 bg-navy-800 dark:bg-navy-800 rounded-t-xl ${className}`}
      {...props}
    />
  )
);

CardHeader.displayName = 'CardHeader';

interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const CardBody = forwardRef<HTMLDivElement, CardBodyProps>(
  ({ className = '', ...props }, ref) => (
    <div ref={ref} className={`p-6 ${className}`} {...props} />
  )
);

CardBody.displayName = 'CardBody';

interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`px-6 py-4 border-t border-navy-600 dark:border-navy-600 bg-navy-800 dark:bg-navy-800 flex gap-3 justify-end rounded-b-xl ${className}`}
      {...props}
    />
  )
);

CardFooter.displayName = 'CardFooter';
