import type { ResolutionTool } from "@moltbooky/core/domain/types";
import { createDb, eq, pipedreamConnections } from "@moltbooky/db";
import type { ResolverPipedreamTool } from "./types";

const appHostHints: Record<string, string[]> = {
  github: ["api.github.com", "github.com"],
  google_calendar: ["googleapis.com"],
  google_drive: ["googleapis.com"],
  gmail: ["googleapis.com"],
  linkedin: ["api.linkedin.com", "linkedin.com"],
  slack: ["slack.com"],
  strava: ["strava.com"]
};

export type PipedreamApiFetchRequest = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  app?: string;
  connectionId?: string;
};

export type PipedreamApiFetchResult = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: string;
  json?: unknown;
  appSlug: string;
  appName?: string;
  url: string;
};

function parseResolutionTools(value: string | null): ResolverPipedreamTool[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as ResolutionTool | ResolutionTool[];
    const tools = Array.isArray(parsed) ? parsed : [parsed];
    return tools.filter((tool): tool is ResolverPipedreamTool => tool?.type === "pipedream_action");
  } catch {
    return [];
  }
}

export async function loadPipedreamResolutionTools(env: Env, creatorId: string, connectionIds: string[], legacyResolutionTool: string | null): Promise<ResolverPipedreamTool[]> {
  const uniqueConnectionIds = Array.from(new Set(connectionIds.filter(Boolean)));
  if (uniqueConnectionIds.length === 0) {
    return parseResolutionTools(legacyResolutionTool);
  }

  const db = createDb(env.DATABASE_URL);
  const connections = await db.select().from(pipedreamConnections).where(eq(pipedreamConnections.userId, creatorId));
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const tools: ResolverPipedreamTool[] = [];
  for (const connectionId of uniqueConnectionIds) {
    const connection = connectionsById.get(connectionId);
    if (!connection) {
      continue;
    }
    tools.push({
      type: "pipedream_action",
      connectionId: connection.id,
      externalUserId: creatorId,
      appSlug: connection.appSlug,
      appName: connection.appName,
      authPropName: connection.authPropName,
      accountId: connection.accountId,
      actionKey: `${connection.appSlug}-api-proxy`,
      instructions: `Use ${connection.appName} only to verify evidence relevant to this market.`
    });
  }
  return tools;
}

/**
 * Builds resolution tools for a head-to-head challenge, one per (participant, required app) pair.
 * Each tool carries its own externalUserId so the resolver can reach BOTH participants' accounts
 * even when they connected the same app (e.g. both GitHub). `participants` maps an externalUserId
 * to a connectionId per app and a human label.
 */
export async function loadHeadToHeadResolutionTools(
  env: Env,
  participants: { externalUserId: string; label: string; connectionIds: string[] }[]
): Promise<ResolverPipedreamTool[]> {
  const db = createDb(env.DATABASE_URL);
  const tools: ResolverPipedreamTool[] = [];
  for (const participant of participants) {
    const wanted = new Set(participant.connectionIds.filter(Boolean));
    if (wanted.size === 0) {
      continue;
    }
    const connections = await db.select().from(pipedreamConnections).where(eq(pipedreamConnections.userId, participant.externalUserId));
    for (const connection of connections) {
      if (!wanted.has(connection.id)) {
        continue;
      }
      tools.push({
        type: "pipedream_action",
        connectionId: connection.id,
        externalUserId: participant.externalUserId,
        participantLabel: participant.label,
        appSlug: connection.appSlug,
        appName: connection.appName,
        authPropName: connection.authPropName,
        accountId: connection.accountId,
        actionKey: `${connection.appSlug}-api-proxy`,
        instructions: `Use ${participant.label}'s ${connection.appName} only to verify evidence relevant to this challenge.`
      });
    }
  }
  return tools;
}

function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function appendParams(url: string, params?: PipedreamApiFetchRequest["params"]): string {
  if (!params) {
    return url;
  }
  const parsedUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      parsedUrl.searchParams.set(key, String(value));
    }
  }
  return parsedUrl.toString();
}

function matchToolsByUrl(url: string, resolutionTools: ResolverPipedreamTool[]): ResolverPipedreamTool[] {
  const hostname = new URL(url).hostname.toLowerCase();
  return resolutionTools.filter((tool) => {
    const hints = appHostHints[tool.appSlug] ?? [tool.appSlug];
    return hints.some((hint) => hostname === hint || hostname.endsWith(`.${hint}`));
  });
}

type ToolSelection = { tool: ResolverPipedreamTool } | { error: string };

/**
 * Selects which connection authenticates a request. An explicit connectionId always wins. An
 * `app` selector is used only when it uniquely identifies a connection. Otherwise we fall back to
 * URL-host inference — but when two participants share an app host (both GitHub), inference is
 * ambiguous and we return an error telling the model to pass an explicit connectionId.
 */
function resolvePipedreamTool(input: PipedreamApiFetchRequest, resolutionTools: ResolverPipedreamTool[]): ToolSelection {
  if (input.connectionId) {
    const found = resolutionTools.find((tool) => tool.connectionId === input.connectionId);
    return found ? { tool: found } : { error: `No connected account matches connectionId "${input.connectionId}". Available: ${formatAvailableConnections(resolutionTools)}.` };
  }
  if (input.app) {
    const byApp = resolutionTools.filter((tool) => tool.appSlug === input.app);
    if (byApp.length === 1) {
      return { tool: byApp[0] };
    }
    if (byApp.length > 1) {
      return { error: `Multiple connected accounts use app "${input.app}". Pass an explicit connectionId. Available: ${formatAvailableConnections(resolutionTools)}.` };
    }
    return { error: `No connected account uses app "${input.app}". Available: ${formatAvailableConnections(resolutionTools)}.` };
  }

  const matches = matchToolsByUrl(input.url, resolutionTools);
  if (matches.length === 1) {
    return { tool: matches[0] };
  }
  if (matches.length > 1) {
    return { error: `${matches.length} connected accounts can authenticate ${input.url}. Pass an explicit connectionId to choose whose account. Available: ${formatAvailableConnections(resolutionTools)}.` };
  }
  return { error: `No selected connected-account API can authenticate ${input.url}. Available connected-account APIs: ${formatAvailableConnections(resolutionTools)}.` };
}

function publicHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (!key.toLowerCase().includes("authorization") && !key.toLowerCase().includes("token")) {
      output[key] = value;
    }
  }
  return output;
}

export async function createPipedreamAccessToken(env: Env, scope: string): Promise<string | null> {
  if (!env.PIPEDREAM_CLIENT_ID || !env.PIPEDREAM_CLIENT_SECRET || !env.PIPEDREAM_PROJECT_ID) {
    return null;
  }

  const tokenResponse = await fetch("https://api.pipedream.com/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.PIPEDREAM_CLIENT_ID,
      client_secret: env.PIPEDREAM_CLIENT_SECRET,
      scope
    })
  });
  const tokenJson = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenJson.access_token) {
    return null;
  }
  return tokenJson.access_token;
}

export async function runPipedreamApiFetch(
  env: Env,
  input: PipedreamApiFetchRequest,
  resolutionTools: ResolverPipedreamTool[]
): Promise<PipedreamApiFetchResult | { error: string; details?: unknown }> {
  if (!env.PIPEDREAM_CLIENT_ID || !env.PIPEDREAM_CLIENT_SECRET || !env.PIPEDREAM_PROJECT_ID) {
    return { error: "Connected-account API auth is not configured for the resolver." };
  }

  const selection = resolvePipedreamTool(input, resolutionTools);
  if ("error" in selection) {
    return { error: selection.error };
  }
  const resolutionTool = selection.tool;
  if (!resolutionTool.accountId) {
    return { error: `${resolutionTool.appName ?? resolutionTool.appSlug} is not fully connected.` };
  }
  const externalUserId = resolutionTool.externalUserId;
  if (!externalUserId) {
    return { error: `${resolutionTool.appName ?? resolutionTool.appSlug} has no associated user for authentication.` };
  }

  const method = input.method ?? "GET";
  const token = await createPipedreamAccessToken(env, "connect:*");
  if (!token) {
    return { error: "Could not authenticate connected-account API requests." };
  }

  const targetUrl = appendParams(input.url, input.params);
  const proxyUrl = `https://api.pipedream.com/v1/connect/${encodeURIComponent(env.PIPEDREAM_PROJECT_ID)}/proxy/${encodeURIComponent(encodeBase64(targetUrl))}`;
  const proxyHeaders: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "x-pd-environment": env.PIPEDREAM_PROJECT_ENVIRONMENT ?? "development"
  };
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    proxyHeaders[`x-pd-proxy-${key.toLowerCase()}`] = value;
  }

  const requestInit: RequestInit = {
    method,
    headers: {
      ...proxyHeaders,
      ...(method === "GET" || method === "DELETE" ? {} : { "content-type": "application/json" })
    }
  };
  if (method !== "GET" && method !== "DELETE" && input.body !== undefined) {
    requestInit.body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  }

  const url = new URL(proxyUrl);
  url.searchParams.set("external_user_id", externalUserId);
  url.searchParams.set("account_id", resolutionTool.accountId);

  const response = await fetch(url, requestInit);
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: publicHeaders(response.headers),
    text: text.length > 20_000 ? `${text.slice(0, 20_000)}...` : text,
    ...(json === undefined ? {} : { json }),
    appSlug: resolutionTool.appSlug,
    appName: resolutionTool.appName,
    url: targetUrl
  };
}

export function formatAvailableConnections(resolutionTools: ResolverPipedreamTool[]): string {
  return resolutionTools
    .map((resolutionTool) => {
      const owner = resolutionTool.participantLabel ? `${resolutionTool.participantLabel}'s ` : "";
      const selector = resolutionTool.connectionId ? `, connectionId: ${resolutionTool.connectionId}` : "";
      return `${owner}${resolutionTool.appName ?? resolutionTool.appSlug} (app: ${resolutionTool.appSlug}${selector})`;
    })
    .join("; ");
}
