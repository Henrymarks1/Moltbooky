import { provisionalDisputeDeadline } from "@moltbooky/core/domain/challenge";
import type { Challenge, ResolutionEvent, ResolutionOutcome, ResolutionTool } from "@moltbooky/core/domain/types";
import { and, challengeMatches, challenges, createDb, eq, ledgerEntries, or, pipedreamConnections, resolutionRuns, creditAccounts } from "@moltbooky/db";
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
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
type ResolutionEventEmitter = (
  kind: ResolutionEvent["kind"],
  title: string,
  body?: string | null,
  metadata?: Record<string, unknown>
) => Promise<void>;

const resolveRequestSchema = z.object({
  challengeId: z.string().min(1),
  runId: z.string().min(1),
  challenge: z.object({
    id: z.string().min(1),
    creatorId: z.string().min(1),
    claim: z.string().min(1),
    resolutionCriteria: z.string().min(1),
    resolutionTool: z.unknown().nullable().optional(),
    pipedreamConnectionIds: z.array(z.string()).default([]),
    creatorSide: z.enum(["YES", "NO"]),
    visibility: z.enum(["public", "private"]),
    stakeCents: z.number().int(),
    matchedCents: z.number().int(),
    status: z.string(),
    expiresAt: z.string()
  }),
  eventCallbackUrl: z.string().url(),
  eventCallbackToken: z.string().min(1)
});

type ResolveRequest = z.infer<typeof resolveRequestSchema> & { challenge: Challenge };

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

export async function resolveChallenge(env: Env, request: ResolveRequest): Promise<ResolverResult> {
  const db = createDb(env.DATABASE_URL);
  const { challengeId, runId } = request;
  const emit = (kind: ResolutionEvent["kind"], title: string, body?: string | null, metadata: Record<string, unknown> = {}) =>
    appendResolutionEvent(request, kind, title, body, metadata);

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

  const exaQuery = `${request.challenge.claim}\nResolution criteria: ${request.challenge.resolutionCriteria}`;
  const resolutionTools = await loadPipedreamResolutionTools(env, challenge.creatorId, challenge.pipedreamConnectionIds ?? [], challenge.resolutionTool);
  const resolverResult = await runAiResolver(env, emit, exaQuery, resolutionTools, challenge.creatorId);

  await db
    .insert(resolutionRuns)
    .values({
      id: runId,
      challengeId,
      exaQuery,
      sourceUrls: JSON.stringify(resolverResult.sourceUrls),
      aiRationale: resolverResult.shortRationale,
      proposedOutcome: resolverResult.outcome,
      confidence: resolverResult.confidence
    })
    .onConflictDoNothing();
  await emit("run_finished", "Resolver finished", resolverResult.shortRationale, {
    outcome: resolverResult.outcome,
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

async function applyCreditDelta(tx: any, userId: string, availableDeltaCents: number, lockedDeltaCents: number): Promise<void> {
  const creditAccount = await tx.select().from(creditAccounts).where(eq(creditAccounts.userId, userId)).for("update").limit(1);
  if (!creditAccount[0]) {
    throw new Error("Credit account not found.");
  }

  await tx
    .update(creditAccounts)
    .set({
      availableCents: creditAccount[0].availableCents + availableDeltaCents,
      lockedCents: creditAccount[0].lockedCents + lockedDeltaCents,
      updatedAt: new Date()
    })
    .where(eq(creditAccounts.userId, userId));
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
      await applyCreditDelta(tx, challenge.creatorId, challenge.stakeCents, -challenge.stakeCents);
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
      await applyCreditDelta(tx, match.matcherId, match.amountCents, -match.amountCents);
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

async function runAiResolver(env: Env, emit: ResolutionEventEmitter, query: string, resolutionTools: ResolverPipedreamTool[] = [], externalUserId = ""): Promise<ResolverResult> {
  await emit("run_started", "Resolver started", "Building evidence plan and preparing tools.");

  if (!env.EXA_API_KEY || !env.OPENAI_API_KEY) {
    await emit("error", "Resolver keys missing", "Resolver keys are not configured; leaving challenge unresolved.");
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale: "Resolver keys are not configured; leaving challenge unresolved."
    };
  }

  const searchedUrls = new Set<string>();
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const tools: Parameters<typeof streamText>[0]["tools"] = {
    exaSearch: tool({
      description: "Search the web with Exa for evidence relevant to resolving the challenge.",
      inputSchema: z.object({
        query: z.string().min(1),
        numResults: z.number().int().min(1).max(10).default(5)
      }),
      execute: async ({ query: searchQuery, numResults }) => {
        await emit("tool_call", "Calling Exa web search", searchQuery, { toolName: "exaSearch", numResults });
        const searchResponse = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": env.EXA_API_KEY!
          },
          body: JSON.stringify({ query: searchQuery, numResults, type: "auto" })
        });

        if (!searchResponse.ok) {
          await emit("error", "Exa search failed", `Exa search failed with status ${searchResponse.status}.`, { toolName: "exaSearch" });
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

        await emit("tool_result", "Exa returned evidence", `${results.length} results returned.`, {
          toolName: "exaSearch",
          urls: results.map((result) => result.url).filter(Boolean).slice(0, 5)
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
          await emit("error", "Pipedream connection unavailable", `Pipedream connection ${connectionId} is not attached to this challenge.`, { toolName: "pipedreamAction" });
          return { error: `Pipedream connection ${connectionId} is not attached to this challenge.` };
        }
        await emit("tool_call", `Calling ${resolutionTool.appName ?? resolutionTool.appSlug}`, JSON.stringify(props, null, 2), {
          toolName: "pipedreamAction",
          connectionId
        });
        const output = await runPipedreamAction(env, resolutionTool, props, externalUserId);
        await emit("tool_result", `${resolutionTool.appName ?? resolutionTool.appSlug} returned evidence`, summarizeToolOutput(output), {
          toolName: "pipedreamAction",
          connectionId
        });
        return output;
      }
    });
  }

  let streamedText = "";
  const outputBuffer: string[] = [];
  const emitOutput = async (force = false) => {
    if (outputBuffer.length === 0) {
      return;
    }
    const body = outputBuffer.join("");
    if (!force && body.length < 80) {
      return;
    }
    outputBuffer.length = 0;
    await emit("agent_output", "Drafting resolution", body);
  };

  const result = streamText({
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
    tools,
    onStepFinish: async (event) => {
      await emit("model_step", "Model step finished", `Finish reason: ${event.finishReason}.`, {
        finishReason: event.finishReason,
        usage: event.usage
      });
    }
  });
  for await (const part of result.fullStream) {
    if (part.type === "start-step") {
      await emit("model_step", "Model step started", "The resolver is deciding what evidence to gather next.");
    } else if (part.type === "tool-input-start") {
      await emit("tool_call", `Preparing ${part.toolName}`, "Choosing the tool input.");
    } else if (part.type === "tool-call") {
      await emit("tool_call", `Requested ${part.toolName}`, JSON.stringify(part.input, null, 2), { toolName: part.toolName });
    } else if (part.type === "tool-result") {
      await emit("tool_result", `${part.toolName} completed`, summarizeToolOutput(part.output), { toolName: part.toolName });
    } else if (part.type === "text-delta") {
      streamedText += part.text;
      outputBuffer.push(part.text);
      await emitOutput();
    } else if (part.type === "error") {
      await emit("error", "Resolver stream error", part.error instanceof Error ? part.error.message : String(part.error));
    }
  }
  await emitOutput(true);

  const finalText = streamedText || (await result.text);
  const parsed = parseResolverJson(finalText);
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

async function appendResolutionEvent(
  request: ResolveRequest,
  kind: ResolutionEvent["kind"],
  title: string,
  body?: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const response = await fetch(request.eventCallbackUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${request.eventCallbackToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
    id: newId("rev"),
      challengeId: request.challengeId,
      runId: request.runId,
    kind,
    title,
    body,
      metadata
    })
  });
  if (!response.ok) {
    throw new Error(`Could not append resolver event: ${response.status}`);
  }
}

function summarizeToolOutput(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  if (!text) {
    return "Tool returned no text output.";
  }
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
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

function isManualResolverRequestAllowed(request: Request, env: Env): boolean {
  const configuredToken = env.RESOLVER_TEST_TOKEN?.trim();
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(configuredToken && bearerToken === configuredToken);
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return Response.json({ ok: true, name: "Moltbooky Resolver" });
  }

  if (request.method === "POST" && url.pathname === "/resolve") {
    if (!isManualResolverRequestAllowed(request, env)) {
      return Response.json({ error: "Resolver access is not allowed." }, { status: 403 });
    }
    const parsed = resolveRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: "Invalid resolver request." }, { status: 400 });
    }
    const result = await resolveChallenge(env, parsed.data as ResolveRequest);
    return Response.json({ ok: true, challengeId: parsed.data.challengeId, runId: parsed.data.runId, result });
  }

  return Response.json({ error: "Not found." }, { status: 404 });
}

export default {
  fetch: handleFetch
};
