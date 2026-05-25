import type { ChallengeStatus } from "@moltbooky/core/domain/types";
import { Badge } from "./ui/badge";

const labels: Record<ChallengeStatus, string> = {
  draft: "Draft",
  open: "Open",
  resolving: "Resolving",
  provisional_resolved: "Provisional",
  final_resolved: "Final",
  cancelled: "Cancelled",
  expired_unmatched: "Expired",
  voided: "Voided",
  disputed: "Disputed"
};

export function StatusPill({ status }: { status: ChallengeStatus }) {
  return <Badge className={`status-${status}`}>{labels[status]}</Badge>;
}
