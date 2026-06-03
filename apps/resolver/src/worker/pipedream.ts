import type { ResolutionTool } from "@moltbooky/core/domain/types";
import { createDb, eq, pipedreamConnections } from "@moltbooky/db";
import type { ResolverPipedreamTool } from "./types";

const defaultPipedreamActionKeys: Record<string, string> = {
  linkedin: "linkedin-get-profile",
  github: "github-get-repository",
  strava: "strava-list-activities",
  slack: "slack-fetch-conversation-history",
  gmail: "gmail-search-emails",
  google_drive: "google_drive-search-files",
  google_calendar: "google_calendar-list-events"
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
      appSlug: connection.appSlug,
      appName: connection.appName,
      authPropName: connection.authPropName,
      accountId: connection.accountId,
      actionKey: defaultPipedreamActionKeys[connection.appSlug] ?? `${connection.appSlug}-make-api-request`,
      instructions: `Use ${connection.appName} only to verify evidence relevant to this market.`
    });
  }
  return tools;
}

export async function runPipedreamAction(env: Env, resolutionTool: ResolverPipedreamTool, props: Record<string, unknown>, externalUserId: string): Promise<unknown> {
  if (!env.PIPEDREAM_CLIENT_ID || !env.PIPEDREAM_CLIENT_SECRET || !env.PIPEDREAM_PROJECT_ID) {
    return { error: "Pipedream is not configured for the resolver." };
  }

  const tokenResponse = await fetch("https://api.pipedream.com/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.PIPEDREAM_CLIENT_ID,
      client_secret: env.PIPEDREAM_CLIENT_SECRET,
      scope: "connect:actions:*"
    })
  });
  const tokenJson = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenJson.access_token) {
    return { error: tokenJson.error ?? "Could not authenticate with Pipedream." };
  }

  const configuredProps = {
    ...(resolutionTool.configuredProps ?? {}),
    ...props,
    ...(resolutionTool.accountId
      ? {
          [resolutionTool.authPropName]: {
            authProvisionId: resolutionTool.accountId
          }
        }
      : {})
  };

  const response = await fetch(`https://api.pipedream.com/v1/connect/${env.PIPEDREAM_PROJECT_ID}/actions/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokenJson.access_token}`,
      "x-pd-environment": env.PIPEDREAM_PROJECT_ENVIRONMENT ?? "development"
    },
    body: JSON.stringify({
      external_user_id: externalUserId,
      id: resolutionTool.actionKey,
      configured_props: configuredProps
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: `Pipedream action failed with status ${response.status}`, details: data };
  }
  return data;
}

export function formatAvailableConnections(resolutionTools: ResolverPipedreamTool[]): string {
  return resolutionTools
    .map((resolutionTool) => `${resolutionTool.connectionId ?? resolutionTool.appSlug}: ${resolutionTool.appName ?? resolutionTool.appSlug} (${resolutionTool.actionKey})`)
    .join("; ");
}
