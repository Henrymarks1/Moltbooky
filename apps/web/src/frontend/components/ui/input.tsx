import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn("h-11 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring", className)}
    {...props}
  />
));
Input.displayName = "Input";
