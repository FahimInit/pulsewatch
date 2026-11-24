import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-[8px] border border-pw-border bg-white px-3 py-2 text-[12px] text-pw-text placeholder:text-pw-muted focus:border-pw-primary focus:outline-none focus:ring-2 focus:ring-pw-primary/15 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-[8px] border border-pw-border bg-white px-3 py-2 text-[12px] text-pw-text placeholder:text-pw-muted focus:border-pw-primary focus:outline-none focus:ring-2 focus:ring-pw-primary/15 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-[11px] font-semibold text-pw-text mb-1.5', className)}
      {...props}
    />
  );
}
