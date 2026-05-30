import { provisionalDisputeDeadline } from "@moltbooky/core/domain/challenge";
import type { ResolutionOutcome, ResolutionTool } from "@moltbooky/core/domain/types";
import { and, challengeMatches, challenges, createDb, eq, ledgerEntries, lte, or, pipedreamConnections, resolutionRuns, walletAccounts } from "@moltbooky/db";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

export interface ResolverResult {
  outcome: ResolutionOutcome;
  confidence: number;
  sourceUrls: string[];
  shortRationale: string;
}

const resolverResultSchema = z.object({
  outcome: z.enum(["YES", "NO", "UNRESOLVED"]),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string().url()).default([]),
  shortRationale: z.string().min(1)
});

const resolverSystemPrompt = [
  "You are Moltbooky's provisional resolution agent for private-beta 1:1 challenge bets.",
  "Your job is to evaluate a binary claim against its resolution criteria using external evidence.",
  "Use the exaSearch tool when evidence could be current, factual, or externally verifiable.",
  "If the challenge includes Pipedream connections, use pipedreamAction only for evidence directly relevant to the stated criteria.",
  "Return YES only when the evidence clearly satisfies the claim and criteria.",
  "Return NO only when the evidence clearly contradicts the claim or criteria.",
  "Return UNRESOLVED when evidence is missing, ambiguous, inaccessible, conflicting, stale, or below the confidence threshold.",
  "Be conservative because AI resolution is provisional and users may dispute outcomes.",
  "Do not infer beyond the stated criteria. Do not settle based on popularity, vibes, or predictions.",
  "The response must be a single JSON object with outcome, confidence, sourceUrls, and shortRationale."
].join("\n");

type ResolverPipedreamTool = ResolutionTool & { connectionId?: string };

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

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function enqueueOpenChallenges(env: Env): Promise<number> {
  const db = createDb(env.DATABASE_URL);
  const results = await db
    .select({ id: challenges.id })
    .from(challenges)
    .where(and(eq(challenges.status, "open"), lte(challenges.expiresAt, new Date())))
    .limit(50);

  for (const row of results) {
    await env.RESOLUTION_QUEUE.send({ challengeId: row.id });
  }

  return results.length;
}

export async function resolveChallenge(env: Env, challengeId: string): Promise<ResolverResult> {
  const db = createDb(env.DATABASE_URL);
  await db
    .update(challenges)
    .set({
      status: "resolving",
      updatedAt: new Date()
    })
    .where(and(eq(challenges.id, challengeId), eq(challenges.status, "open")));

  const rows = await db
    .select({
      creatorId: challenges.creatorId,
      stakeCents: challenges.stakeCents,
      status: challenges.status,
      provisionalOutcome: challenges.provisionalOutcome,
      claim: challenges.claim,
      resolutionCriteria: challenges.resolutionCriteria,
      resolutionTool: challenges.resolutionTool,
      pipedreamConnectionIds: challenges.pipedreamConnectionIds
    })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .limit(1);
  const challenge = rows[0];

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  if (challenge.status === "voided" || challenge.status === "final_resolved") {
    return {
      outcome: (challenge.provisionalOutcome as ResolutionOutcome | null) ?? "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale: "Challenge is already closed."
    };
  }

  if (challenge.status === "provisional_resolved" && challenge.provisionalOutcome === "UNRESOLVED") {
    await refundUnresolvedChallenge(env, challengeId);
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale: "Challenge was already unresolved; refunded locked stakes."
    };
  }

  const exaQuery = `${challenge.claim}\nResolution criteria: ${challenge.resolutionCriteria}`;
  const resolutionTools = await loadPipedreamResolutionTools(env, challenge.creatorId, challenge.pipedreamConnectionIds ?? [], challenge.resolutionTool);
  const resolverResult = await runAiResolver(env, exaQuery, resolutionTools, challenge.creatorId);

  await db.insert(resolutionRuns).values({
    id: newId("res"),
    challengeId,
    exaQuery,
    sourceUrls: JSON.stringify(resolverResult.sourceUrls),
    aiRationale: resolverResult.shortRationale,
    proposedOutcome: resolverResult.outcome,
    confidence: resolverResult.confidence
  });

  if (resolverResult.outcome === "UNRESOLVED") {
    await refundUnresolvedChallenge(env, challengeId);
    return resolverResult;
  }

  await db
    .update(challenges)
    .set({
      status: "provisional_resolved",
      provisionalOutcome: resolverResult.outcome,
      disputeDeadlineAt: new Date(provisionalDisputeDeadline()),
      updatedAt: new Date()
    })
    .where(and(eq(challenges.id, challengeId), or(eq(challenges.status, "open"), eq(challenges.status, "resolving"))));

  return resolverResult;
}

async function applyWalletDelta(tx: any, userId: string, availableDeltaCents: number, lockedDeltaCents: number): Promise<void> {
  const wallet = await tx.select().from(walletAccounts).where(eq(walletAccounts.userId, userId)).for("update").limit(1);
  if (!wallet[0]) {
    throw new Error("Credit account not found.");
  }

  await tx
    .update(walletAccounts)
    .set({
      availableCents: wallet[0].availableCents + availableDeltaCents,
      lockedCents: wallet[0].lockedCents + lockedDeltaCents,
      updatedAt: new Date()
    })
    .where(eq(walletAccounts.userId, userId));
}

async function refundUnresolvedChallenge(env: Env, challengeId: string): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  await db.transaction(async (tx) => {
    const current = await tx.select().from(challenges).where(eq(challenges.id, challengeId)).for("update").limit(1);
    const challenge = current[0];

    if (!challenge) {
      throw new Error("Challenge not found.");
    }
    if (challenge.status === "voided" || challenge.status === "final_resolved") {
      return;
    }

    const matches = await tx.select().from(challengeMatches).where(eq(challengeMatches.challengeId, challengeId)).for("update");

    if (challenge.stakeCents > 0) {
      await applyWalletDelta(tx, challenge.creatorId, challenge.stakeCents, -challenge.stakeCents);
      await tx
        .insert(ledgerEntries)
        .values({
          id: newId("led"),
          userId: challenge.creatorId,
          type: "unlock",
          amountCents: challenge.stakeCents,
          challengeId,
          idempotencyKey: `unresolved-refund:${challengeId}:creator`,
          description: "Refund unresolved challenge stake"
        })
        .onConflictDoNothing();
    }

    for (const match of matches) {
      await applyWalletDelta(tx, match.matcherId, match.amountCents, -match.amountCents);
      await tx
        .insert(ledgerEntries)
        .values({
          id: newId("led"),
          userId: match.matcherId,
          type: "unlock",
          amountCents: match.amountCents,
          challengeId,
          matchId: match.id,
          idempotencyKey: `unresolved-refund:${challengeId}:match:${match.id}`,
          description: "Refund unresolved match stake"
        })
        .onConflictDoNothing();
    }

    await tx.update(challengeMatches).set({ status: "cancelled" }).where(eq(challengeMatches.challengeId, challengeId));
    await tx
      .update(challenges)
      .set({
        status: "voided",
        provisionalOutcome: "UNRESOLVED",
        disputeDeadlineAt: null,
        updatedAt: new Date()
      })
      .where(eq(challenges.id, challengeId));
  });
}

async function loadPipedreamResolutionTools(env: Env, creatorId: string, connectionIds: string[], legacyResolutionTool: string | null): Promise<ResolverPipedreamTool[]> {
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

async function runAiResolver(env: Env, query: string, resolutionTools: ResolverPipedreamTool[] = [], externalUserId = ""): Promise<ResolverResult> {
  if (!env.EXA_API_KEY || !env.OPENAI_API_KEY) {
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale: "Resolver keys are not configured; leaving challenge unresolved."
    };
  }

  const searchedUrls = new Set<string>();
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const tools: Parameters<typeof generateText>[0]["tools"] = {
    exaSearch: tool({
      description: "Search the web with Exa for evidence relevant to resolving the challenge.",
      inputSchema: z.object({
        query: z.string().min(1),
        numResults: z.number().int().min(1).max(10).default(5)
      }),
      execute: async ({ query: searchQuery, numResults }) => {
        const searchResponse = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": env.EXA_API_KEY!
          },
          body: JSON.stringify({ query: searchQuery, numResults, type: "auto" })
        });

        if (!searchResponse.ok) {
          return {
            error: `Exa search failed with status ${searchResponse.status}`,
            results: []
          };
        }

        const searchJson = (await searchResponse.json()) as {
          results?: Array<{ url?: string; title?: string; text?: string; publishedDate?: string; author?: string }>;
        };
        const results = (searchJson.results ?? []).map((source) => {
          if (source.url) {
            searchedUrls.add(source.url);
          }

          return {
            url: source.url ?? null,
            title: source.title ?? null,
            text: source.text ?? null,
            publishedDate: source.publishedDate ?? null,
            author: source.author ?? null
          };
        });

        return { results };
      }
    })
  };

  if (resolutionTools.length > 0) {
    const availableConnections = resolutionTools
      .map((resolutionTool) => `${resolutionTool.connectionId ?? resolutionTool.appSlug}: ${resolutionTool.appName ?? resolutionTool.appSlug} (${resolutionTool.actionKey})`)
      .join("; ");
    tools.pipedreamAction = tool({
      description: [
        `Run one of the market's configured Pipedream connections for authenticated evidence. Available connections: ${availableConnections}.`,
        "Only request props needed to evaluate the resolution criteria. Do not use this tool for unrelated exploration."
      ].filter(Boolean).join(" "),
      inputSchema: z.object({
        connectionId: z.string().min(1).describe("The configured connection id to use."),
        props: z.record(z.string(), z.unknown()).default({})
      }),
      execute: async ({ connectionId, props }) => {
        const resolutionTool = resolutionTools.find((tool) => tool.connectionId === connectionId || tool.appSlug === connectionId);
        if (!resolutionTool) {
          return { error: `Pipedream connection ${connectionId} is not attached to this challenge.` };
        }
        return runPipedreamAction(env, resolutionTool, props, externalUserId);
      }
    });
  }

  const result = await generateText({
    model: openai("gpt-4o-mini"),
    temperature: 0,
    stopWhen: stepCountIs(4),
    system: resolverSystemPrompt,
    prompt: [
      "Resolve this Moltbooky challenge.",
      resolutionTools.length ? "Use Exa and the configured Pipedream connections when they can supply relevant evidence, then return only the required JSON object." : "Use Exa for evidence, then return only the required JSON object.",
      "",
      query
    ].join("\n"),
    tools
  });

  const parsed = parseResolverJson(result.text);
  const validated = resolverResultSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: Array.from(searchedUrls),
      shortRationale: "Resolver agent did not return a valid resolution object."
    };
  }

  return {
    ...validated.data,
    sourceUrls: validated.data.sourceUrls.length > 0 ? validated.data.sourceUrls : Array.from(searchedUrls)
  };
}

async function runPipedreamAction(env: Env, resolutionTool: ResolverPipedreamTool, props: Record<string, unknown>, externalUserId: string): Promise<unknown> {
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

function parseResolverJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

export default {
  fetch: () => Response.json({ ok: true, name: "Moltbooky Resolver" }),
  scheduled: async (_event: ScheduledEvent, env: Env) => {
    await enqueueOpenChallenges(env);
  },
  queue: async (batch: MessageBatch<{ challengeId: string }>, env: Env) => {
    for (const message of batch.messages) {
      await resolveChallenge(env, message.body.challengeId);
      message.ack();
    }
  }
};
