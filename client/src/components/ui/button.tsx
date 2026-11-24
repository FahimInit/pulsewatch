import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pw-primary/40 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary: 'bg-pw-primary text-white border border-pw-primary hover:bg-pw-primary-hover shadow-xs',
        secondary: 'bg-white text-pw-subtle border border-pw-border hover:bg-pw-bg hover:text-pw-text',
        danger: 'bg-pw-red text-white border border-pw-red hover:opacity-90',
        outlineDanger: 'bg-pw-red-bg text-pw-red border border-pw-red/20 hover:bg-pw-red/15',
        ghost: 'bg-transparent text-pw-subtle hover:bg-pw-bg hover:text-pw-primary border border-transparent',
      },
      size: {
        default: 'px-[15px] py-[9px] text-[11.5px]',
        sm: 'px-[12px] py-[7px] text-[11px]',
        xs: 'px-[9px] py-[5px] text-[10.5px]',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';
