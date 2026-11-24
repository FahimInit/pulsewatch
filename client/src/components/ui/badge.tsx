import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[10px] font-semibold leading-none',
  {
    variants: {
      variant: {
        operational: 'bg-pw-green-bg text-pw-green',
        degraded: 'bg-pw-orange-bg text-pw-orange',
        down: 'bg-pw-red-bg text-pw-red',
        paused: 'bg-[#f0f0f5] text-pw-muted',
        pending: 'bg-pw-blue-bg text-pw-blue',
        purple: 'bg-pw-primary-light text-pw-primary',
        investigating: 'bg-pw-red-bg text-pw-red',
        identified: 'bg-pw-orange-bg text-pw-orange',
        monitoring: 'bg-pw-blue-bg text-pw-blue',
        resolved: 'bg-pw-green-bg text-pw-green',
      },
    },
    defaultVariants: {
      variant: 'operational',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
