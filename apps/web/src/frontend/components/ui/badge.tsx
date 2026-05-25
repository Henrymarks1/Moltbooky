import * as React from "react";
import { cn } from "../../lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "outline" | "positive" | "negative";
};

const variants = {
  default: "bg-muted text-muted-foreground",
  outline: "border border-border bg-card text-muted-foreground",
  positive: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  negative: "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 text-xs font-semibold", variants[variant], className)}
      {...props}
    />
  );
}
