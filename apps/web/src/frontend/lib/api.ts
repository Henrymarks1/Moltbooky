import { availableToMatch, oppositeSide, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { creditsToCents } from "@moltbooky/core/domain/money";
import type { Challenge, ChallengeMatch, LedgerEntryType, WalletAccount } from "@moltbooky/core/domain/types";
import { isTestingModeEnabled, testingUser } from "./testingMode";

type LedgerEntry = { id: string; type: LedgerEntryType; amountCents: number; description: string; createdAt: string };

type FakeState = {
  wallet: WalletAccount;
  challenges: Challenge[];
  matches: ChallengeMatch[];
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
      challenges: (parsed.challenges ?? []).map((challenge) => ({ ...challenge, visibility: challenge.visibility ?? "public" })),
      matches: parsed.matches ?? [],
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
    return Promise.resolve({ checkoutUrl: window.location.href, sessionId: newId("play_credit_purchase") });
  }

  const requestInit = {
    method: "POST",
    body: JSON.stringify({ amountCents })
  };

  return request<{ checkoutUrl: string; sessionId: string }>("/api/payments/credit-purchases", requestInit).catch((error) => {
    if (error instanceof Error && error.message.includes("/api/payments/credit-purchases")) {
      return request<{ checkoutUrl: string; sessionId: string }>("/api/payments/deposits", requestInit);
    }
    throw error;
  });
}

export const api = {
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
      return {
        challenges: [...state.challenges]
          .filter((challenge) => challenge.creatorId === testingUser.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      };
    }
    return request<{ challenges: Challenge[] }>("/api/my/challenges");
  },
  getChallenge: async (id: string) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const challenge = state.challenges.find((item) => item.id === id);
      if (!challenge) {
        throw new Error("Testing challenge not found.");
      }
      return {
        challenge,
        matches: state.matches.filter((match) => match.challengeId === id),
        availableToMatchCents: availableToMatch(challenge)
      };
    }
    return request<{ challenge: Challenge; matches: ChallengeMatch[]; availableToMatchCents: number }>(`/api/challenges/${id}`);
  },
  createChallenge: (body: {
    claim: string;
    resolutionCriteria: string;
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
