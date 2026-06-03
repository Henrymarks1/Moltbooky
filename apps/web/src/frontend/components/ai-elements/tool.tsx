import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

export type ToolPart = ToolUIPart | DynamicToolUIPart;
export type ToolState = ToolPart["state"];

export type ToolProps = ComponentProps<"details"> & {
  defaultOpen?: boolean;
};

export function Tool({ className, defaultOpen = false, children, ...props }: ToolProps) {
  return (
    <details className={cn("group not-prose w-full rounded-md border", className)} open={defaultOpen} {...props}>
      {children}
    </details>
  );
}

const statusLabels: Record<ToolState, string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error"
};

const statusIcons: Record<ToolState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />
};

export function getStatusBadge(status: ToolState) {
  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="default">
      {statusIcons[status]}
      {statusLabels[status]}
    </Badge>
  );
}

export type ToolHeaderProps = ComponentProps<"summary"> & {
  title?: string;
  state: ToolState;
  type: ToolUIPart["type"] | DynamicToolUIPart["type"];
  toolName?: string;
};

export function ToolHeader({ className, title, type, state, toolName, ...props }: ToolHeaderProps) {
  const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <summary
      className={cn("flex w-full cursor-pointer list-none items-center justify-between gap-4 p-3 text-left marker:hidden [&::-webkit-details-marker]:hidden", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
  );
}

export type ToolContentProps = ComponentProps<"div">;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return <div className={cn("space-y-4 border-t p-4 text-popover-foreground outline-none", className)} {...props} />;
}

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export function ToolInput({ className, input, ...props }: ToolInputProps) {
  return (
    <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Parameters</h4>
      <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs leading-5">{JSON.stringify(input, null, 2)}</pre>
    </div>
  );
}

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText?: ToolPart["errorText"];
};

export function ToolOutput({ className, output, errorText, ...props }: ToolOutputProps) {
  if (!(output || errorText)) {
    return null;
  }

  let renderedOutput = <div>{output as ReactNode}</div>;
  if (typeof output === "object" && !isValidElement(output)) {
    renderedOutput = <pre className="overflow-x-auto p-3 text-xs leading-5">{JSON.stringify(output, null, 2)}</pre>;
  } else if (typeof output === "string") {
    renderedOutput = <pre className="overflow-x-auto p-3 text-xs leading-5">{output}</pre>;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{errorText ? "Error" : "Result"}</h4>
      <div className={cn("overflow-x-auto rounded-md text-xs", errorText ? "bg-destructive/10 p-3 text-destructive" : "bg-muted/50 text-foreground")}>
        {errorText ? <div>{errorText}</div> : renderedOutput}
      </div>
    </div>
  );
}
