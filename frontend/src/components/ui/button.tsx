import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-sans text-sm font-bold transition-all duration-300 ease-[var(--ease-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none active:translate-y-px active:shadow-none",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground shadow-offset hover:-translate-y-0.5",
        gradient: "border-primary bg-primary text-primary-foreground shadow-offset hover:-translate-y-0.5",
        secondary: "border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/90",
        outline: "border-2 border-input bg-card text-foreground shadow-offset-sm hover:bg-muted",
        ghost: "border-transparent hover:bg-muted text-foreground",
        destructive: "border-destructive bg-destructive text-destructive-foreground shadow-offset-sm hover:-translate-y-0.5",
        success: "border-success bg-success text-success-foreground shadow-offset-sm hover:-translate-y-0.5",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 rounded-lg px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-[3.25rem] rounded-2xl px-7 text-base",
        icon: "h-10 w-10 rounded-xl",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };