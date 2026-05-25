import { formatMoney } from "../../domain/money";
import type { Challenge } from "../../domain/types";

export function money(cents: number): string {
  return formatMoney(cents);
}

export function matchProgress(challenge: Challenge): number {
  if (challenge.stakeCents === 0) {
    return 0;
  }
  return Math.round((challenge.matchedCents / challenge.stakeCents) * 100);
}

export function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
