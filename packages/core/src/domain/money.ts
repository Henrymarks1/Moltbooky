export const PLATFORM_FEE_BPS = 200;
export const MIN_CHALLENGE_STAKE_CENTS = 500;
export const PRIVATE_BETA_MAX_STAKE_CENTS = 10_000;
export const DISPUTE_WINDOW_HOURS = 24;

export function dollarsToCents(value: string | number): number {
  const normalized = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Amount must be a positive dollar value with at most two decimals.");
  }

  const [dollars, cents = ""] = normalized.split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}

export function creditsToCents(value: string | number): number {
  const normalized = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Amount must be a positive credit value with at most two decimals.");
  }

  const [credits, fractionalCredits = ""] = normalized.split(".");
  return Number(credits) * 100 + Number(fractionalCredits.padEnd(2, "0"));
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

export function formatCredits(cents: number): string {
  const credits = cents / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(credits);

  return `${formatted} ${credits === 1 ? "credit" : "credits"}`;
}

export function assertStakeWithinBetaLimits(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Stake must be a positive platform credit amount.");
  }
  if (amountCents < MIN_CHALLENGE_STAKE_CENTS) {
    throw new Error("Minimum challenge stake is 5 credits.");
  }
  if (amountCents > PRIVATE_BETA_MAX_STAKE_CENTS) {
    throw new Error("Private beta challenge stake limit is 100 credits.");
  }
}

export function profitFeeCents(profitCents: number): number {
  if (profitCents <= 0) {
    return 0;
  }
  return Math.floor((profitCents * PLATFORM_FEE_BPS) / 10_000);
}
