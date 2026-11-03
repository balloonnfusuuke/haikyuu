import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0d48a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e1210] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-[#e24b4b] text-white hover:bg-[#cf3f3f]",
        secondary: "bg-[#232a24] text-[#f4f1ea] hover:bg-[#2d362f]",
        outline: "border border-[#3c4a3e] bg-[#101410]/80 text-[#f4f1ea] hover:bg-[#232a24]",
        ghost: "text-[#f4f1ea] hover:bg-white/10",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 rounded-md px-2.5 text-xs",
        lg: "h-11 px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
