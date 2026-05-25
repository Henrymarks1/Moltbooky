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

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

export function assertStakeWithinBetaLimits(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Stake must be a positive whole-cent amount.");
  }
  if (amountCents < MIN_CHALLENGE_STAKE_CENTS) {
    throw new Error("Minimum challenge stake is $5.");
  }
  if (amountCents > PRIVATE_BETA_MAX_STAKE_CENTS) {
    throw new Error("Private beta challenge stake limit is $100.");
  }
}

export function profitFeeCents(profitCents: number): number {
  if (profitCents <= 0) {
    return 0;
  }
  return Math.floor((profitCents * PLATFORM_FEE_BPS) / 10_000);
}
