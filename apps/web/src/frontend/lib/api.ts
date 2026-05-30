import { availableToMatch, oppositeSide, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { creditsToCents } from "@moltbooky/core/domain/money";
import type { Challenge, ChallengeMatch, LedgerEntryType, ResolutionRun, WalletAccount } from "@moltbooky/core/domain/types";
import { isTestingModeEnabled, testingUser } from "./testingMode";

type LedgerEntry = { id: string; type: LedgerEntryType; amountCents: number; description: string; createdAt: string };
export type PipedreamApp = {
  id: string;
  nameSlug: string;
  name: string;
  description?: string;
  imgSrc?: string;
  categories?: string[];
  authType?: string;
};
export type PipedreamConnection = {
  id: string;
  appSlug: string;
  appName: string;
  accountId: string;
  authPropName: string;
  createdAt: string;
  updatedAt: string;
};
export type ChallengeDraft = {
  claim?: string;
  resolutionCriteria?: string;
  creatorSide?: "YES" | "NO";
  visibility?: "public" | "private";
  stakeCredits?: string;
  expiresAt?: string;
  pipedreamConnectionIds?: string[];
};

type FakeState = {
  wallet: WalletAccount;
  challenges: Challenge[];
  matches: ChallengeMatch[];
  resolutionRuns: ResolutionRun[];
  ledger: LedgerEntry[];
};

const fakeStateKey = "moltbooky.testingMode.state";
const startingBalanceCents = 100_000;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function initialFakeState(): FakeState {
  return {
    wallet: {
      userId: testingUser.id,
      availableCents: startingBalanceCents,
      lockedCents: 0,
      pendingWithdrawalCents: 0
    },
    challenges: [],
    matches: [],
    resolutionRuns: [],
    ledger: [
      {
        id: newId("le"),
        type: "credit_purchase",
        amountCents: startingBalanceCents,
        description: "Seed platform credits",
        createdAt: nowIso()
      }
    ]
  };
}

function readFakeState(): FakeState {
  const raw = window.localStorage.getItem(fakeStateKey);
  if (!raw) {
    const state = initialFakeState();
    writeFakeState(state);
    return state;
  }

  try {
    const parsed = JSON.parse(raw) as FakeState;
    return {
      ...parsed,
      wallet: { ...initialFakeState().wallet, ...parsed.wallet },
      challenges: (parsed.challenges ?? []).map((challenge) => ({
        ...challenge,
        visibility: challenge.visibility ?? "public",
        resolutionTool: challenge.resolutionTool ?? null,
        pipedreamConnectionIds: challenge.pipedreamConnectionIds ?? []
      })),
      matches: parsed.matches ?? [],
      resolutionRuns: parsed.resolutionRuns ?? [],
      ledger: parsed.ledger ?? []
    };
  } catch {
    const state = initialFakeState();
    writeFakeState(state);
    return state;
  }
}

function writeFakeState(state: FakeState): void {
  window.localStorage.setItem(fakeStateKey, JSON.stringify(state));
}

function fakeLedger(type: LedgerEntryType, amountCents: number, description: string): LedgerEntry {
  return {
    id: newId("le"),
    type,
    amountCents,
    description,
    createdAt: nowIso()
  };
}

function requireFakeFunds(state: FakeState, amountCents: number): void {
  if (state.wallet.availableCents < amountCents) {
    throw new Error("Not enough available credits.");
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });

  const rawBody = await response.text();
  let data: (T & { error?: string }) | null = null;
  if (rawBody.trim()) {
    try {
      data = JSON.parse(rawBody) as T & { error?: string };
    } catch {
      throw new Error(response.ok ? `Unexpected response from ${path}.` : `Request failed for ${path}.`);
    }
  }

  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed for ${path}.`);
  }
  if (!data) {
    throw new Error(`Empty response from ${path}.`);
  }
  return data;
}

function canUseLocalDevFallback(): boolean {
  return import.meta.env.DEV && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

function createCreditPurchase(amountCents: number) {
  if (isTestingModeEnabled()) {
    const state = readFakeState();
    state.wallet.availableCents += amountCents;
    state.ledger.unshift(fakeLedger("credit_purchase", amountCents, "Add testing credits"));
    writeFakeState(state);
    return Promise.resolve({ onrampUrl: window.location.href, depositAddress: "testing-mode", chain: "base" as const, asset: "USDC" as const });
  }

  const requestInit = {
    method: "POST",
    body: JSON.stringify({ amountCents })
  };

  return request<{ onrampUrl: string; depositAddress: string; chain: "base"; asset: "USDC" }>("/api/payments/onramp-session", requestInit);
}

export const api = {
  paymentsConfig: () => {
    if (isTestingModeEnabled()) {
      return Promise.resolve({ creditPurchasesEnabled: true, cashoutsEnabled: true });
    }
    return request<{ creditPurchasesEnabled: boolean; cashoutsEnabled: boolean; chain?: "base"; asset?: "USDC" }>("/api/payments/config").catch(() => ({
      creditPurchasesEnabled: false,
      cashoutsEnabled: false
    }));
  },
  listChallenges: async () => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      return {
        challenges: state.challenges
          .filter((challenge) => challenge.visibility === "public")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      };
    }
    return request<{ challenges: Challenge[] }>("/api/challenges").catch((error) => {
      if (canUseLocalDevFallback()) {
        console.warn("Using an empty local market feed because /api/challenges could not be loaded.", error);
        return { challenges: [] };
      }
      throw error;
    });
  },
  listMyChallenges: async () => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const matches = state.matches.filter((match) => match.matcherId === testingUser.id);
      const matchedChallengeIds = new Set(matches.map((match) => match.challengeId));
      return {
        challenges: [...state.challenges]
          .filter((challenge) => challenge.creatorId === testingUser.id || matchedChallengeIds.has(challenge.id))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        matches
      };
    }
    return request<{ challenges: Challenge[]; matches: ChallengeMatch[] }>("/api/my/challenges");
  },
  getChallenge: async (id: string) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const challenge = state.challenges.find((item) => item.id === id);
      if (!challenge) {
        throw new Error("Testing challenge not found.");
      }
      if (new Date(challenge.expiresAt).getTime() <= Date.now() && state.resolutionRuns.every((run) => run.challengeId !== id)) {
        const proposedOutcome = "UNRESOLVED" as const;
        challenge.status = "provisional_resolved";
        challenge.provisionalOutcome = proposedOutcome;
        state.resolutionRuns.unshift({
          id: newId("play_res"),
          challengeId: challenge.id,
          exaQuery: `${challenge.claim}\nResolution criteria: ${challenge.resolutionCriteria}`,
          sourceUrls: [],
          aiRationale: "Testing mode does not call the external resolver, so this market is left unresolved.",
          proposedOutcome,
          confidence: 0,
          createdAt: nowIso()
        });
        writeFakeState(state);
      }
      return {
        challenge,
        matches: state.matches.filter((match) => match.challengeId === id).map((match) => ({ ...match, matcherName: testingUser.name })),
        resolutionRuns: state.resolutionRuns.filter((run) => run.challengeId === id),
        availableToMatchCents: availableToMatch(challenge)
      };
    }
    return request<{ challenge: Challenge; matches: ChallengeMatch[]; resolutionRuns: ResolutionRun[]; availableToMatchCents: number }>(`/api/challenges/${id}`);
  },
  getChallengeDraft: () => request<{ challenge: { id: string; draft: ChallengeDraft } | null }>("/api/challenges/draft"),
  saveChallengeDraft: (draft: ChallengeDraft) => request<{ challenge: { id: string; draft: ChallengeDraft } }>("/api/challenges/draft", { method: "PUT", body: JSON.stringify({ draft }) }),
  deleteChallengeDraft: () => request<{ deleted: boolean }>("/api/challenges/draft", { method: "DELETE" }),
  createChallenge: (body: {
    claim: string;
    resolutionCriteria: string;
    pipedreamConnectionIds?: string[];
    creatorSide: "YES" | "NO";
    visibility: "public" | "private";
    stakeCredits: string;
    expiresAt: string;
  }) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const stakeCents = creditsToCents(body.stakeCredits);
      validateChallengeInput({ ...body, stakeCents });
      requireFakeFunds(state, stakeCents);

      const challenge: Challenge = {
        id: newId("play_ch"),
        creatorId: testingUser.id,
        claim: body.claim.trim(),
        resolutionCriteria: body.resolutionCriteria.trim(),
        resolutionTool: null,
        pipedreamConnectionIds: body.pipedreamConnectionIds ?? [],
        creatorSide: body.creatorSide,
        visibility: body.visibility,
        stakeCents,
        matchedCents: 0,
        status: "open",
        expiresAt: body.expiresAt,
        createdAt: nowIso()
      };

      state.wallet.availableCents -= stakeCents;
      state.wallet.lockedCents += stakeCents;
      state.challenges.push(challenge);
      state.ledger.unshift(fakeLedger("lock", stakeCents, "Lock creator credit stake"));
      writeFakeState(state);
      return Promise.resolve({ challenge });
    }

    return request<{ challenge: Challenge }>("/api/challenges", { method: "POST", body: JSON.stringify(body) });
  },
  matchChallenge: (id: string, amountCredits: string) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const challenge = state.challenges.find((item) => item.id === id);
      if (!challenge) {
        throw new Error("Testing challenge not found.");
      }
      const amountCents = creditsToCents(amountCredits);
      validateMatchAmount(challenge, amountCents);
      requireFakeFunds(state, amountCents);

      const match: ChallengeMatch = {
        id: newId("play_ma"),
        challengeId: challenge.id,
        matcherId: testingUser.id,
        matcherName: testingUser.name,
        amountCents,
        side: oppositeSide(challenge.creatorSide),
        status: "active",
        createdAt: nowIso()
      };

      challenge.matchedCents += amountCents;
      state.wallet.availableCents -= amountCents;
      state.wallet.lockedCents += amountCents;
      state.matches.push(match);
      state.ledger.unshift(fakeLedger("match_lock", amountCents, "Lock matcher credit stake"));
      writeFakeState(state);
      return Promise.resolve({ challenge, match });
    }

    return request<{ challenge: Challenge; match: ChallengeMatch }>(`/api/challenges/${id}/matches`, {
      method: "POST",
      body: JSON.stringify({ amountCredits })
    });
  },
  cancelUnmatched: (id: string) =>
    request<{ challenge: Challenge; unlockedCents: number }>(`/api/challenges/${id}/cancel-unmatched`, { method: "POST" }),
  deleteChallenge: (id: string) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const challenge = state.challenges.find((item) => item.id === id);
      if (!challenge) {
        throw new Error("Testing challenge not found.");
      }
      if (challenge.matchedCents > 0 || state.matches.some((match) => match.challengeId === id)) {
        throw new Error("Only testing challenges with no matches can be deleted.");
      }

      state.challenges = state.challenges.filter((item) => item.id !== id);
      state.wallet.availableCents += challenge.stakeCents;
      state.wallet.lockedCents -= challenge.stakeCents;
      state.ledger.unshift(fakeLedger("unlock", challenge.stakeCents, "Release deleted credit stake"));
      writeFakeState(state);
      return Promise.resolve({ deleted: true, unlockedCents: challenge.stakeCents });
    }

    return request<{ deleted: boolean; unlockedCents: number }>(`/api/challenges/${id}`, { method: "DELETE" });
  },
  wallet: () => {
    if (isTestingModeEnabled()) {
      return Promise.resolve({ wallet: readFakeState().wallet });
    }
    return request<{ wallet: WalletAccount }>("/api/wallet");
  },
  ledger: () => {
    if (isTestingModeEnabled()) {
      return Promise.resolve({ ledger: readFakeState().ledger });
    }
    return request<{ ledger: LedgerEntry[] }>("/api/ledger");
  },
  createCreditPurchase,
  createDeposit: createCreditPurchase,
  setupPaymentWallet: (body: { privyUserId?: string; withdrawalAddress?: string }) =>
    request<{ chain: "base"; asset: "USDC"; depositAddress: string; withdrawalAddress: string | null; privyUserId: string | null }>("/api/payments/wallet/setup", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  syncDeposits: () => request<{ creditedCents: number; deposits: number; scannedToBlock: number }>("/api/payments/deposits/sync", { method: "POST" }),
  listPipedreamApps: (query?: string) =>
    request<{ apps: PipedreamApp[] }>(`/api/integrations/pipedream/apps${query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`),
  listPipedreamConnections: () => request<{ connections: PipedreamConnection[] }>("/api/integrations/pipedream/connections"),
  savePipedreamConnection: (body: { appSlug: string; appName: string; accountId: string; authPropName: string }) =>
    request<{ connection: PipedreamConnection }>("/api/integrations/pipedream/connections", { method: "POST", body: JSON.stringify(body) }),
  createPipedreamConnectToken: () =>
    request<{ token: string; expiresAt?: string; connectLinkUrl?: string; externalUserId: string }>("/api/integrations/pipedream/connect-token", { method: "POST" }),
  payoutStatus: () => {
    if (isTestingModeEnabled()) {
      return Promise.resolve({ cashoutsEnabled: true, connected: true, payoutsEnabled: true, onboardingRequired: false, withdrawalAddress: null });
    }
    return request<{ cashoutsEnabled: boolean; connected: boolean; payoutsEnabled: boolean; onboardingRequired: boolean; withdrawalAddress: string | null }>("/api/payments/connect/status");
  },
  createWithdrawal: (amountCents: number) => {
    if (isTestingModeEnabled()) {
      if (amountCents <= 0) {
        throw new Error("Cashout amount must be positive.");
      }
      const state = readFakeState();
      requireFakeFunds(state, amountCents);
      state.wallet.availableCents -= amountCents;
      state.wallet.pendingWithdrawalCents += amountCents;
      state.ledger.unshift(fakeLedger("withdrawal", amountCents, "Cashout requested"));
      writeFakeState(state);
      return Promise.resolve({ wallet: state.wallet });
    }

    return request<{ wallet: WalletAccount; transactionHash: string; withdrawalAddress: string }>("/api/payments/withdrawals", { method: "POST", body: JSON.stringify({ amountCents }) });
  },
  createApiKey: (name: string) => {
    if (isTestingModeEnabled()) {
      return Promise.resolve({ apiKey: { id: newId("play_key"), secret: `play_${name.trim().toLowerCase().replace(/\s+/g, "_") || "agent"}_key` } });
    }
    return request<{ apiKey: { id: string; secret: string } }>("/api/api-keys", { method: "POST", body: JSON.stringify({ name }) });
  },
  finalize: (id: string, outcome: "YES" | "NO") =>
    request<{ challenge: Challenge }>(`/api/admin/challenges/${id}/finalize`, { method: "POST", body: JSON.stringify({ outcome }) }),
  voidChallenge: (id: string) => request<{ challenge: Challenge }>(`/api/admin/challenges/${id}/void`, { method: "POST" })
};
