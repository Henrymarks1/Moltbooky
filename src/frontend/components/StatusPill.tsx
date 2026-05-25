import type { ChallengeStatus } from "../../domain/types";

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
  return <span className={`status status-${status}`}>{labels[status]}</span>;
}
