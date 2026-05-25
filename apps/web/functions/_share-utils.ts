export interface ChallengePreview {
  id: string;
  claim: string;
  resolutionCriteria: string;
  creatorSide: "YES" | "NO";
  stakeCents: number;
  matchedCents: number;
  status: string;
  expiresAt: string;
}

export interface ChallengeResponse {
  challenge: ChallengePreview;
  availableToMatchCents: number;
}

export interface ShareEnv {
  API_ORIGIN?: string;
}

const defaultApiOrigin = "http://localhost:8787";

export function apiOriginForRequest(request: Request, env: ShareEnv): string | undefined {
  const url = new URL(request.url);
  const isLocalRequest = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return env.API_ORIGIN ?? (isLocalRequest ? defaultApiOrigin : undefined);
}

export async function fetchChallengePreview(request: Request, env: ShareEnv, id: string): Promise<ChallengeResponse | null> {
  const targetOrigin = apiOriginForRequest(request, env);
  if (!targetOrigin) {
    return null;
  }

  const targetUrl = new URL(`/api/challenges/${encodeURIComponent(id)}`, targetOrigin);
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      headers: {
        accept: "application/json"
      }
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as ChallengeResponse;
}

export function credits(cents: number): string {
  const value = cents / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2
  }).format(value);

  return `${formatted} ${value === 1 ? "credit" : "credits"}`;
}

export function formatShortDate(dateValue: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(dateValue));
}

export function absoluteUrl(request: Request, path: string): string {
  return new URL(path, new URL(request.url).origin).toString();
}

export function truncate(value: string, maxLength: number): string {
  const cleanValue = value.replace(/\s+/g, " ").trim();
  if (cleanValue.length <= maxLength) {
    return cleanValue;
  }
  return `${cleanValue.slice(0, maxLength - 1).trimEnd()}...`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function wrapText(value: string, maxLineLength: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxLineLength) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }
    currentLine = word;

    if (lines.length === maxLines) {
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\.+$/, "")}...`;
  }

  return lines;
}
