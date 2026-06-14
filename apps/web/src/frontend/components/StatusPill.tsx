import type { ChallengeStatus } from "@moltbooky/core/domain/types";
import { Badge } from "./ui/badge";

const labels: Record<ChallengeStatus, string> = {
  open: "Open",
  pending_acceptance: "Awaiting opponent",
  resolving: "Resolving",
  provisional_resolved: "Provisional",
  final_resolved: "Final",
  cancelled: "Cancelled",
  expired_unmatched: "Expired",
  voided: "Voided",
  disputed: "Disputed"
};

const variants: Record<ChallengeStatus, string> = {
  open: "bg-secondary text-secondary-foreground",
  pending_acceptance: "bg-muted text-muted-foreground",
  resolving: "bg-secondary text-secondary-foreground",
  provisional_resolved: "bg-secondary text-secondary-foreground",
  final_resolved: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
  expired_unmatched: "bg-muted text-muted-foreground",
  voided: "bg-destructive text-destructive-foreground",
  disputed: "bg-destructive text-destructive-foreground"
};

export function StatusPill({ status }: { status: ChallengeStatus }) {
  return <Badge className={variants[status]}>{labels[status]}</Badge>;
}
