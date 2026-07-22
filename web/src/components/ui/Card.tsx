import { forwardRef, ReactNode } from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={`
        rounded-[5px] border border-[#dbe2ec] bg-white shadow-none dark:border-white/10 dark:bg-slate-900
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
      className={`rounded-t-[5px] border-b border-[#e2e8f0] bg-white px-5 py-4 dark:border-white/10 dark:bg-slate-900 ${className}`}
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
    <div ref={ref} className={`p-5 ${className}`} {...props} />
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
      className={`flex justify-end gap-3 rounded-b-[5px] border-t border-[#e2e8f0] bg-[#f8fafc] px-5 py-4 dark:border-white/10 dark:bg-slate-950 ${className}`}
      {...props}
    />
  )
);

CardFooter.displayName = 'CardFooter';
