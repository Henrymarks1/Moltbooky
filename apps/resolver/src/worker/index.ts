import type { Challenge, ResolutionEvent, ResolutionOutcome, ResolutionTool } from "@moltbooky/core/domain/types";
import { and, challenges, createDb, eq, pipedreamConnections } from "@moltbooky/db";
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";

export interface ResolverResult {
  outcome: ResolutionOutcome;
  confidence: number;
  sourceUrls: string[];
  shortRationale: string;
  finalized?: boolean;
}

const resolverSystemPrompt = [
  "You are Moltbooky's provisional resolution agent for private-beta 1:1 challenge bets.",
  "Your job is to evaluate a binary claim against its resolution criteria using external evidence.",
  "All tokens you emit are public and visible to end users. Write concise, public-facing progress and rationale only.",
  "Use executeCode to gather evidence. Write TypeScript that exports `default async function run(ctx)`.",
  "Inside generated code, use ctx.exa.search(...) for web evidence and ctx.pipedream.run(...) for configured account evidence.",
  "Return YES only when the evidence clearly satisfies the claim and criteria.",
  "Return NO only when the evidence clearly contradicts the claim or criteria.",
  "Use UNKNOWN when evidence is missing, ambiguous, inaccessible, conflicting, stale, or below the confidence threshold.",
  "Be conservative because AI resolution is provisional and users may dispute outcomes.",
  "Do not infer beyond the stated criteria. Do not settle based on popularity, vibes, or predictions.",
  "Your final action must be exactly one resolveBet tool call with a clear explanation paragraph.",
  "After resolveBet succeeds, do not output more content."
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
  finalizeCallbackUrl: z.string().url(),
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

const exaSearchInputSchema = z.object({
  query: z.string().min(1).max(1000),
  numResults: z.number().int().min(1).max(10).default(5)
});

const pipedreamRunInputSchema = z.object({
  connectionId: z.string().min(1),
  action: z.string().min(1).max(180).optional(),
  props: z.record(z.string(), z.unknown()).default({})
});

const executeCodeResultSchema = z.object({
  result: z.unknown().optional(),
  events: z
    .array(
      z.object({
        kind: z.enum(["tool_call", "tool_result", "agent_output", "error"]),
        title: z.string(),
        body: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
    )
    .default([])
});

const resolveBetInputSchema = z.object({
  resolution: z.enum(["YES", "NO", "UNKNOWN"]),
  explanation: z.string().trim().min(1).max(4000)
});

const finalizedResultSchema = z.object({
  ok: z.boolean(),
  result: z.object({
    outcome: z.enum(["YES", "NO", "UNRESOLVED"]),
    explanation: z.string(),
    sourceUrls: z.array(z.string()).default([])
  })
});

type ResolverCodeToolProps = {
  resolutionTools: ResolverPipedreamTool[];
  externalUserId: string;
};

type ResolverExecutionContext = ExecutionContext & {
  exports: {
    ResolverCodeTools: (options: { props: ResolverCodeToolProps }) => unknown;
  };
};

export class ResolverCodeTools extends WorkerEntrypoint<Env, ResolverCodeToolProps> {
  async exaSearch(input: unknown): Promise<unknown> {
    const parsed = exaSearchInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: "Invalid Exa search input." };
    }
    if (!this.env.EXA_API_KEY) {
      return { error: "Exa is not configured for the resolver." };
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.env.EXA_API_KEY
      },
      body: JSON.stringify({ query: parsed.data.query, numResults: parsed.data.numResults, type: "auto" })
    });

    if (!response.ok) {
      return { error: `Exa search failed with status ${response.status}`, results: [] };
    }

    const searchJson = (await response.json()) as {
      results?: Array<{ url?: string; title?: string; text?: string; publishedDate?: string; author?: string }>;
    };
    return {
      results: (searchJson.results ?? []).map((source) => ({
        url: source.url ?? null,
        title: source.title ?? null,
        text: source.text ?? null,
        publishedDate: source.publishedDate ?? null,
        author: source.author ?? null
      }))
    };
  }

  async pipedreamRun(input: unknown): Promise<unknown> {
    const parsed = pipedreamRunInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: "Invalid Pipedream action input." };
    }

    const resolutionTool = this.ctx.props.resolutionTools.find((tool) => tool.connectionId === parsed.data.connectionId || tool.appSlug === parsed.data.connectionId);
    if (!resolutionTool) {
      return { error: `Pipedream connection ${parsed.data.connectionId} is not attached to this challenge.` };
    }

    return runPipedreamAction(
      this.env,
      {
        ...resolutionTool,
        actionKey: parsed.data.action ?? resolutionTool.actionKey
      },
      parsed.data.props,
      this.ctx.props.externalUserId
    );
  }
}

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

export async function resolveChallenge(env: Env, request: ResolveRequest, ctx: ResolverExecutionContext): Promise<ResolverResult> {
  const db = createDb(env.DATABASE_URL);
  const { challengeId } = request;
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
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale: "Challenge was already marked unresolved."
    };
  }

  const exaQuery = `${request.challenge.claim}\nResolution criteria: ${request.challenge.resolutionCriteria}`;
  const resolutionTools = await loadPipedreamResolutionTools(env, challenge.creatorId, challenge.pipedreamConnectionIds ?? [], challenge.resolutionTool);
  return runAiResolver(env, ctx, request, emit, exaQuery, resolutionTools, challenge.creatorId);
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

async function runAiResolver(
  env: Env,
  ctx: ResolverExecutionContext,
  request: ResolveRequest,
  emit: ResolutionEventEmitter,
  query: string,
  resolutionTools: ResolverPipedreamTool[] = [],
  externalUserId = ""
): Promise<ResolverResult> {
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
  let finalResult: ResolverResult | null = null;
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const tools: Parameters<typeof streamText>[0]["tools"] = {
    executeCode: tool({
      description: [
        "Write TypeScript evidence-gathering code and run it inside a sandboxed Cloudflare Dynamic Worker.",
        "The code must export `default async function run(ctx)`.",
        "Use ctx.exa.search({ query, numResults }) for web evidence.",
        resolutionTools.length
          ? `Use ctx.pipedream.run({ connectionId, action, props }) for configured account evidence. Available connections: ${formatAvailableConnections(resolutionTools)}.`
          : "No private Pipedream connections are configured for this challenge.",
        "Return structured evidence that helps decide YES, NO, or UNKNOWN."
      ].join(" "),
      inputSchema: z.object({
        purpose: z.string().min(1).max(500),
        code: z.string().min(1).max(20_000)
      }),
      execute: async ({ purpose, code }) => {
        await emit("tool_call", "Executing resolver code", purpose, { toolName: "executeCode" });
        const output = await executeResolverCode(env, ctx, {
          code,
          resolutionTools,
          externalUserId
        });
        for (const event of output.events) {
          await emit(event.kind, event.title, event.body, {
            ...(event.metadata ?? {}),
            toolName: "executeCode"
          });
        }
        for (const url of collectUrls(output.result)) {
          searchedUrls.add(url);
        }
        await emit("tool_result", "Resolver code returned evidence", summarizeToolOutput(output.result), { toolName: "executeCode" });
        return output.result;
      }
    }),
    resolveBet: tool({
      description: "Terminal tool. Finalize the bet as YES, NO, or UNKNOWN with a public explanation paragraph. This must be the last action.",
      inputSchema: z.object({
        resolution: z.enum(["YES", "NO", "UNKNOWN"]),
        explanation: z.string().trim().min(1).max(4000)
      }),
      execute: async (input) => {
        const parsed = resolveBetInputSchema.parse(input);
        await emit("tool_call", "Finalizing bet", parsed.explanation, { toolName: "resolveBet", resolution: parsed.resolution });
        const sourceUrls = Array.from(searchedUrls);
        const response = await fetch(request.finalizeCallbackUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${request.eventCallbackToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            runId: request.runId,
            resolution: parsed.resolution,
            explanation: parsed.explanation,
            confidence: parsed.resolution === "UNKNOWN" ? 0 : 1,
            sourceUrls
          })
        });

        const json = (await response.json().catch(() => ({}))) as unknown;
        if (!response.ok) {
          const message = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : `Finalization failed with status ${response.status}.`;
          await emit("error", "Bet finalization failed", message, { toolName: "resolveBet" });
          return { error: message };
        }

        const finalized = finalizedResultSchema.safeParse(json);
        const outcome = finalized.success ? finalized.data.result.outcome : parsed.resolution === "UNKNOWN" ? "UNRESOLVED" : parsed.resolution;
        finalResult = {
          outcome,
          confidence: parsed.resolution === "UNKNOWN" ? 0 : 1,
          sourceUrls,
          shortRationale: parsed.explanation,
          finalized: true
        };
        await emit("tool_result", "Bet finalized", parsed.explanation, { toolName: "resolveBet", outcome });
        return { ok: true, outcome };
      }
    })
  };

  const result = streamText({
    model: openai("gpt-4o-mini"),
    temperature: 0,
    stopWhen: stepCountIs(8),
    system: resolverSystemPrompt,
    prompt: [
      "Resolve this Moltbooky challenge.",
      "All text you write is public and visible to users.",
      "Use executeCode to gather evidence. Then call resolveBet exactly once.",
      "Do not return JSON as text. The final answer must be the resolveBet tool call.",
      resolutionTools.length ? `Configured Pipedream connections: ${formatAvailableConnections(resolutionTools)}.` : "Configured Pipedream connections: none.",
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
      await emit("agent_output", "Resolver note", part.text);
    } else if (part.type === "error") {
      await emit("error", "Resolver stream error", part.error instanceof Error ? part.error.message : String(part.error));
    }
  }

  if (!finalResult) {
    const rationale = "Resolver agent stopped before calling the final resolution tool. The bet was not settled.";
    await emit("error", "Resolver did not finalize", rationale);
    return {
    outcome: "UNRESOLVED",
    confidence: 0,
    sourceUrls: Array.from(searchedUrls),
    shortRationale: rationale,
    finalized: false
  };
}

  return finalResult;
}

function formatAvailableConnections(resolutionTools: ResolverPipedreamTool[]): string {
  return resolutionTools
    .map((resolutionTool) => `${resolutionTool.connectionId ?? resolutionTool.appSlug}: ${resolutionTool.appName ?? resolutionTool.appSlug} (${resolutionTool.actionKey})`)
    .join("; ");
}

function dynamicWorkerHostSource(): string {
  return `
import run from "./agent";

function summarize(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text && text.length > 500 ? text.slice(0, 500) + "..." : text;
}

function urlsFrom(value, urls = []) {
  if (!value) return urls;
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\\/\\/[^\\s"'<>]+/g)) urls.push(match[0]);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) urlsFrom(item, urls);
    return urls;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) urlsFrom(item, urls);
  }
  return urls;
}

export default {
  async fetch(_request, env) {
    const events = [];
    const ctx = {
      exa: {
        search: async (input) => {
          events.push({ kind: "tool_call", title: "Calling Exa web search", body: input?.query ?? null, metadata: { helper: "ctx.exa.search" } });
          const result = await env.RESOLVER_TOOLS.exaSearch(input);
          events.push({ kind: "tool_result", title: "Exa returned evidence", body: summarize(result), metadata: { helper: "ctx.exa.search", urls: urlsFrom(result).slice(0, 10) } });
          return result;
        }
      },
      pipedream: {
        run: async (input) => {
          events.push({ kind: "tool_call", title: "Calling Pipedream action", body: JSON.stringify({ connectionId: input?.connectionId, action: input?.action ?? null }), metadata: { helper: "ctx.pipedream.run", connectionId: input?.connectionId } });
          const result = await env.RESOLVER_TOOLS.pipedreamRun(input);
          events.push({ kind: "tool_result", title: "Pipedream returned evidence", body: summarize(result), metadata: { helper: "ctx.pipedream.run", connectionId: input?.connectionId, urls: urlsFrom(result).slice(0, 10) } });
          return result;
        }
      },
      log: (message, data) => {
        events.push({ kind: "agent_output", title: String(message), body: data === undefined ? null : summarize(data), metadata: { helper: "ctx.log" } });
      }
    };

    try {
      const result = await run(ctx);
      return Response.json({ result, events });
    } catch (error) {
      events.push({ kind: "error", title: "Resolver code failed", body: error instanceof Error ? error.message : String(error), metadata: { helper: "executeCode" } });
      return Response.json({ result: { error: error instanceof Error ? error.message : String(error) }, events }, { status: 500 });
    }
  }
};
`;
}

async function executeResolverCode(
  env: Env,
  ctx: ResolverExecutionContext,
  params: {
    code: string;
    resolutionTools: ResolverPipedreamTool[];
    externalUserId: string;
  }
): Promise<z.infer<typeof executeCodeResultSchema>> {
  if (!env.LOADER) {
    return {
      result: { error: "Dynamic Worker Loader is not configured." },
      events: [{ kind: "error", title: "Dynamic Worker Loader missing", body: "Configure the resolver worker LOADER binding before running generated code." }]
    };
  }

  const { createWorker } = await import("@cloudflare/worker-bundler");
  const bundled = await createWorker({
    files: {
      "src/index.ts": dynamicWorkerHostSource(),
      "src/agent.ts": params.code,
      "package.json": JSON.stringify({ dependencies: {} })
    },
    entryPoint: "src/index.ts",
    bundle: true,
    minify: false,
    target: "es2022"
  });

  const worker = env.LOADER.load({
    mainModule: bundled.mainModule,
    modules: bundled.modules,
    compatibilityDate: "2026-05-30",
    globalOutbound: null,
    env: {
      RESOLVER_TOOLS: ctx.exports.ResolverCodeTools({
        props: {
          resolutionTools: params.resolutionTools,
          externalUserId: params.externalUserId
        }
      })
    }
  });

  const response = await withTimeout(
    worker.getEntrypoint().fetch(new Request("https://resolver-code.local/run", { method: "POST" })),
    20_000,
    "Generated resolver code timed out."
  );
  const json = (await response.json().catch(() => ({}))) as unknown;
  const parsed = executeCodeResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      result: { error: "Generated resolver code returned an invalid response." },
      events: [{ kind: "error", title: "Invalid resolver code response", body: "The Dynamic Worker did not return the expected result envelope." }]
    };
  }
  return parsed.data;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function collectUrls(value: unknown, urls = new Set<string>()): string[] {
  if (!value) {
    return Array.from(urls);
  }
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      urls.add(match[0]);
    }
    return Array.from(urls);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, urls);
    }
    return Array.from(urls);
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectUrls(item, urls);
    }
  }
  return Array.from(urls);
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

function isManualResolverRequestAllowed(request: Request, env: Env): boolean {
  const configuredToken = env.RESOLVER_TEST_TOKEN?.trim();
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(configuredToken && bearerToken === configuredToken);
}

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    const result = await resolveChallenge(env, parsed.data as ResolveRequest, ctx as ResolverExecutionContext);
    return Response.json({ ok: true, challengeId: parsed.data.challengeId, runId: parsed.data.runId, finalized: result.finalized === true, result });
  }

  return Response.json({ error: "Not found." }, { status: 404 });
}

export default {
  fetch: handleFetch
};
