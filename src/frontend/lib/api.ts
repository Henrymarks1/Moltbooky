import type { Challenge, ChallengeMatch, WalletAccount } from "../../domain/types";

const betaUserId = localStorage.getItem("moltbooky.userId") ?? "henry";
localStorage.setItem("moltbooky.userId", betaUserId);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-user-id": betaUserId,
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
  listChallenges: () => request<{ challenges: Challenge[] }>("/api/challenges"),
  getChallenge: (id: string) =>
    request<{ challenge: Challenge; matches: ChallengeMatch[]; availableToMatchCents: number }>(`/api/challenges/${id}`),
  createChallenge: (body: {
    claim: string;
    resolutionCriteria: string;
    creatorSide: "YES" | "NO";
    stakeDollars: string;
    expiresAt: string;
  }) => request<{ challenge: Challenge }>("/api/challenges", { method: "POST", body: JSON.stringify(body) }),
  matchChallenge: (id: string, amountDollars: string) =>
    request<{ challenge: Challenge; match: ChallengeMatch }>(`/api/challenges/${id}/matches`, {
      method: "POST",
      body: JSON.stringify({ amountDollars })
    }),
  cancelUnmatched: (id: string) =>
    request<{ challenge: Challenge; unlockedCents: number }>(`/api/challenges/${id}/cancel-unmatched`, { method: "POST" }),
  wallet: () => request<{ wallet: WalletAccount }>("/api/wallet"),
  ledger: () => request<{ ledger: Array<{ id: string; type: string; amountCents: number; description: string; createdAt: string }> }>("/api/ledger"),
  createApiKey: (name: string) => request<{ apiKey: { id: string; secret: string } }>("/api/api-keys", { method: "POST", body: JSON.stringify({ name }) }),
  finalize: (id: string, outcome: "YES" | "NO") =>
    request<{ challenge: Challenge }>(`/api/admin/challenges/${id}/finalize`, { method: "POST", body: JSON.stringify({ outcome }) }),
  voidChallenge: (id: string) => request<{ challenge: Challenge }>(`/api/admin/challenges/${id}/void`, { method: "POST" })
};
