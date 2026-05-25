export type Side = "YES" | "NO";
export type ChallengeVisibility = "public" | "private";

export type ChallengeStatus =
  | "draft"
  | "open"
  | "resolving"
  | "provisional_resolved"
  | "final_resolved"
  | "cancelled"
  | "expired_unmatched"
  | "voided"
  | "disputed";

export type LedgerEntryType =
  | "credit_purchase"
  | "deposit"
  | "lock"
  | "unlock"
  | "match_lock"
  | "settlement_win"
  | "settlement_loss"
  | "fee"
  | "withdrawal";

export type ResolutionOutcome = Side | "UNRESOLVED";

export interface Challenge {
  id: string;
  creatorId: string;
  claim: string;
  resolutionCriteria: string;
  creatorSide: Side;
  visibility: ChallengeVisibility;
  stakeCents: number;
  matchedCents: number;
  status: ChallengeStatus;
  expiresAt: string;
  disputeDeadlineAt?: string | null;
  provisionalOutcome?: ResolutionOutcome | null;
  createdAt: string;
}

export interface ChallengeMatch {
  id: string;
  challengeId: string;
  matcherId: string;
  amountCents: number;
  side: Side;
  status: "active" | "settled" | "cancelled";
  createdAt: string;
}

export interface ResolutionRun {
  id: string;
  challengeId: string;
  exaQuery: string;
  sourceUrls: string[];
  aiRationale: string;
  proposedOutcome: ResolutionOutcome;
  confidence: number;
  createdAt: string;
}

export interface WalletAccount {
  userId: string;
  availableCents: number;
  lockedCents: number;
  pendingWithdrawalCents: number;
}

export interface SettlementTransfer {
  userId: string;
  type: LedgerEntryType;
  amountCents: number;
  description: string;
}
