export type Side = "YES" | "NO";
export type ChallengeVisibility = "public" | "private";

export type ChallengeStatus =
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
  | "lock"
  | "unlock"
  | "match_lock"
  | "settlement_win"
  | "settlement_loss"
  | "fee";

export type ResolutionOutcome = Side | "UNRESOLVED";

export interface PipedreamResolutionTool {
  type: "pipedream_action";
  appSlug: string;
  appName?: string;
  authPropName: string;
  accountId?: string;
  actionKey: string;
  configuredProps?: Record<string, unknown>;
  instructions?: string;
}

export type ResolutionTool = PipedreamResolutionTool;
export type ResolutionTools = ResolutionTool[];

export interface Challenge {
  id: string;
  creatorId: string;
  creatorName?: string | null;
  claim: string;
  resolutionCriteria: string;
  resolutionTool?: ResolutionTool | ResolutionTools | null;
  pipedreamConnectionIds: string[];
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
  matcherName?: string | null;
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

export interface CreditAccount {
  userId: string;
  availableCents: number;
  lockedCents: number;
}

export interface SettlementTransfer {
  userId: string;
  type: LedgerEntryType;
  amountCents: number;
  description: string;
}
