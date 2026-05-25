import { availableToMatch, oppositeSide, validateChallengeInput, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import { dollarsToCents } from "@moltbooky/core/domain/money";
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
        type: "deposit",
        amountCents: startingBalanceCents,
        description: "Seed play-money balance",
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
      challenges: parsed.challenges ?? [],
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
    throw new Error("Play-money wallet does not have enough available balance.");
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

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}

export const api = {
  listChallenges: async () => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      return { challenges: [...state.challenges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    }
    return request<{ challenges: Challenge[] }>("/api/challenges");
  },
  getChallenge: async (id: string) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const challenge = state.challenges.find((item) => item.id === id);
      if (!challenge) {
        throw new Error("Play-money challenge not found.");
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
    stakeDollars: string;
    expiresAt: string;
  }) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const stakeCents = dollarsToCents(body.stakeDollars);
      validateChallengeInput({ ...body, stakeCents });
      requireFakeFunds(state, stakeCents);

      const challenge: Challenge = {
        id: newId("play_ch"),
        creatorId: testingUser.id,
        claim: body.claim.trim(),
        resolutionCriteria: body.resolutionCriteria.trim(),
        creatorSide: body.creatorSide,
        stakeCents,
        matchedCents: 0,
        status: "open",
        expiresAt: body.expiresAt,
        createdAt: nowIso()
      };

      state.wallet.availableCents -= stakeCents;
      state.wallet.lockedCents += stakeCents;
      state.challenges.push(challenge);
      state.ledger.unshift(fakeLedger("lock", stakeCents, "Lock play-money creator stake"));
      writeFakeState(state);
      return Promise.resolve({ challenge });
    }

    return request<{ challenge: Challenge }>("/api/challenges", { method: "POST", body: JSON.stringify(body) });
  },
  matchChallenge: (id: string, amountDollars: string) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const challenge = state.challenges.find((item) => item.id === id);
      if (!challenge) {
        throw new Error("Play-money challenge not found.");
      }
      const amountCents = dollarsToCents(amountDollars);
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
      state.ledger.unshift(fakeLedger("match_lock", amountCents, "Lock play-money match stake"));
      writeFakeState(state);
      return Promise.resolve({ challenge, match });
    }

    return request<{ challenge: Challenge; match: ChallengeMatch }>(`/api/challenges/${id}/matches`, {
      method: "POST",
      body: JSON.stringify({ amountDollars })
    });
  },
  cancelUnmatched: (id: string) =>
    request<{ challenge: Challenge; unlockedCents: number }>(`/api/challenges/${id}/cancel-unmatched`, { method: "POST" }),
  deleteChallenge: (id: string) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      const challenge = state.challenges.find((item) => item.id === id);
      if (!challenge) {
        throw new Error("Play-money challenge not found.");
      }
      if (challenge.matchedCents > 0 || state.matches.some((match) => match.challengeId === id)) {
        throw new Error("Only play-money challenges with no matches can be deleted.");
      }

      state.challenges = state.challenges.filter((item) => item.id !== id);
      state.wallet.availableCents += challenge.stakeCents;
      state.wallet.lockedCents -= challenge.stakeCents;
      state.ledger.unshift(fakeLedger("unlock", challenge.stakeCents, "Release deleted play-money stake"));
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
  createDeposit: (amountCents: number) => {
    if (isTestingModeEnabled()) {
      const state = readFakeState();
      state.wallet.availableCents += amountCents;
      state.ledger.unshift(fakeLedger("deposit", amountCents, "Add play money"));
      writeFakeState(state);
      return Promise.resolve({ checkoutUrl: window.location.href, sessionId: newId("play_deposit") });
    }

    return request<{ checkoutUrl: string; sessionId: string }>("/api/payments/deposits", {
      method: "POST",
      body: JSON.stringify({ amountCents })
    });
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
