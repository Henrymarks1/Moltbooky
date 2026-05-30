export type ApiScope = "challenges:read" | "challenges:create" | "matches:create" | "credits:read";

export interface ApiKeyPolicy {
  scopes: ApiScope[];
  maxStakeCents: number;
  dailyStakeLimitCents: number;
  allowCategories: string[];
  denyCategories: string[];
}

export const DEFAULT_AGENT_POLICY: ApiKeyPolicy = {
  scopes: ["challenges:read", "challenges:create", "matches:create", "credits:read"],
  maxStakeCents: 2_500,
  dailyStakeLimitCents: 10_000,
  allowCategories: [],
  denyCategories: ["illegal", "self-harm", "private-person-harassment"]
};

export async function hashApiKey(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createApiKeySecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `mbk_${token}`;
}
