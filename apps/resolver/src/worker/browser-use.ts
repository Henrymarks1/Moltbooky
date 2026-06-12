import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ResolutionEventEmitter } from "./types";
import { collectUrls, summarizeToolOutput } from "./utils";

const browserUseApiBaseUrl = "https://api.browser-use.com/api/v3";
const defaultBrowserUseModel = "claude-sonnet-4.6";
const terminalStatuses = new Set(["idle", "stopped", "timed_out", "error"]);

export const browserUseInputSchema = z.object({
  task: z.string().trim().min(1).max(50_000),
  startUrl: z.string().trim().url().optional(),
  maxSteps: z.number().int().min(1).max(1000).default(60)
});

const browserUseSessionSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional().nullable(),
  output: z.unknown().optional().nullable(),
  liveUrl: z.string().url().optional().nullable(),
  recordingUrls: z.array(z.string()).optional().default([]),
  screenshotUrl: z.string().optional().nullable(),
  lastStepSummary: z.string().optional().nullable(),
  isTaskSuccessful: z.boolean().optional().nullable()
});

const browserUseMessageSchema = z.object({
  id: z.string().min(1),
  role: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  data: z.string().optional().nullable(),
  screenshotUrl: z.string().optional().nullable(),
  hidden: z.boolean().optional().default(false)
});

const browserUseMessagesSchema = z.object({
  messages: z.array(browserUseMessageSchema).default([]),
  hasMore: z.boolean().optional().default(false)
});

export type BrowserUseResult = {
  ok: boolean;
  sessionId?: string;
  liveUrl?: string;
  output?: unknown;
  summary?: string;
  sourceUrls: string[];
  screenshotUrl?: string;
  recordingUrls: string[];
  error?: string;
};

export type BrowserUseFetch = typeof fetch;

export function isBrowserUseConfigured(env: Env): boolean {
  return env.BROWSER_USE_ENABLED !== "false" && Boolean(env.BROWSER_USE_API_KEY);
}

export function createBrowserUseTool(
  env: Env,
  emit: ResolutionEventEmitter,
  params: {
    searchedUrls: Set<string>;
    fetchImpl?: BrowserUseFetch;
    pollDelayMs?: number;
    maxPolls?: number;
  }
): Tool {
  if (!isBrowserUseConfigured(env)) {
    return tool({
      description: "Use Browser Use Cloud to inspect browser-visible evidence. This tool is unavailable because Browser Use is not configured.",
      inputSchema: browserUseInputSchema,
      execute: async () => {
        const error = env.BROWSER_USE_ENABLED === "false" ? "Browser Use is disabled for this resolver." : "Browser Use API key is not configured.";
        await emit("error", "Browser Use unavailable", error, { toolName: "browserUse" });
        return { ok: false, error, sourceUrls: [], recordingUrls: [] };
      }
    });
  }

  return tool({
    description: [
      "Use Browser Use Cloud to inspect pages that require a real browser, JavaScript rendering, page interaction, or browser-visible state.",
      "Provide a precise evidence-gathering task. Include the URL in startUrl when there is a known page to open.",
      "Return only evidence needed for the Moltbooky resolution, with source URLs."
    ].join(" "),
    inputSchema: browserUseInputSchema,
    execute: async (input) => {
      const result = await runBrowserUseEvidence(env, input, emit, {
        fetchImpl: params.fetchImpl,
        maxPolls: params.maxPolls,
        pollDelayMs: params.pollDelayMs
      });
      for (const url of result.sourceUrls) {
        params.searchedUrls.add(url);
      }
      return result;
    }
  });
}

export async function runBrowserUseEvidence(
  env: Env,
  input: unknown,
  emit: ResolutionEventEmitter,
  options: {
    fetchImpl?: BrowserUseFetch;
    pollDelayMs?: number;
    maxPolls?: number;
  } = {}
): Promise<BrowserUseResult> {
  const parsed = browserUseInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid Browser Use input.", sourceUrls: [], recordingUrls: [] };
  }
  if (!isBrowserUseConfigured(env)) {
    return {
      ok: false,
      error: env.BROWSER_USE_ENABLED === "false" ? "Browser Use is disabled for this resolver." : "Browser Use API key is not configured.",
      sourceUrls: [],
      recordingUrls: []
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const pollDelayMs = options.pollDelayMs ?? 2000;
  const maxPolls = options.maxPolls ?? 120;
  const emittedMessageIds = new Set<string>();
  let sessionId = "";

  try {
    await emit("tool_call", "Starting Browser Use", parsed.data.task, {
      toolName: "browserUse",
      startUrl: parsed.data.startUrl ?? null
    });

    const session = await browserUseRequest(fetchImpl, env, "/sessions", {
      method: "POST",
      body: {
        task: parsed.data.startUrl ? `${parsed.data.task}\nStart URL: ${parsed.data.startUrl}` : parsed.data.task,
        model: env.BROWSER_USE_MODEL || defaultBrowserUseModel,
        keepAlive: true,
        enableRecording: true,
        skills: true,
        autoHeal: true,
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            sourceUrls: { type: "array", items: { type: "string" } }
          }
        }
      }
    });
    const parsedSession = browserUseSessionSchema.parse(session);
    sessionId = parsedSession.id;

    if (parsedSession.liveUrl) {
      await emit("tool_result", "Browser live view ready", "The Browser Use live view is available.", {
        toolName: "browserUse",
        browserUseSessionId: parsedSession.id,
        browserUseLiveUrl: parsedSession.liveUrl,
        browserUseScreenshotUrl: parsedSession.screenshotUrl ?? undefined
      });
    }

    let current = parsedSession;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      await emitBrowserUseMessages(fetchImpl, env, current.id, emittedMessageIds, emit);
      current = browserUseSessionSchema.parse(await browserUseRequest(fetchImpl, env, `/sessions/${encodeURIComponent(current.id)}`, { method: "GET" }));
      if (terminalStatuses.has(current.status ?? "")) {
        break;
      }
      await delay(pollDelayMs);
    }

    await emitBrowserUseMessages(fetchImpl, env, current.id, emittedMessageIds, emit);
    const outputText = formatOutput(current.output ?? current.lastStepSummary ?? "");
    const sourceUrls = collectUrls([current.output, current.lastStepSummary, current.screenshotUrl]).slice(0, 20);
    const result: BrowserUseResult = {
      ok: current.status !== "error" && current.status !== "timed_out",
      sessionId: current.id,
      liveUrl: current.liveUrl ?? undefined,
      output: current.output,
      summary: outputText || current.lastStepSummary || undefined,
      sourceUrls,
      screenshotUrl: current.screenshotUrl ?? undefined,
      recordingUrls: current.recordingUrls
    };

    await emit("tool_result", "Browser Use completed", summarizeToolOutput(result), {
      toolName: "browserUse",
      browserUseSessionId: current.id,
      browserUseLiveUrl: current.liveUrl ?? undefined,
      browserUseScreenshotUrl: current.screenshotUrl ?? undefined,
      browserUseRecordingUrls: current.recordingUrls
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit("error", "Browser Use failed", message, {
      toolName: "browserUse",
      browserUseSessionId: sessionId || undefined
    });
    return { ok: false, sessionId: sessionId || undefined, error: message, sourceUrls: [], recordingUrls: [] };
  } finally {
    if (sessionId) {
      await stopBrowserUseSession(fetchImpl, env, sessionId).catch((error) =>
        emit("error", "Browser Use stop failed", error instanceof Error ? error.message : String(error), {
          toolName: "browserUse",
          browserUseSessionId: sessionId
        })
      );
    }
  }
}

async function emitBrowserUseMessages(
  fetchImpl: BrowserUseFetch,
  env: Env,
  sessionId: string,
  emittedMessageIds: Set<string>,
  emit: ResolutionEventEmitter
): Promise<void> {
  let cursor: string | undefined;
  let hasMore: boolean;
  do {
    const path = `/sessions/${encodeURIComponent(sessionId)}/messages?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;
    const page = browserUseMessagesSchema.parse(await browserUseRequest(fetchImpl, env, path, { method: "GET" }));
    hasMore = page.hasMore;
    for (const message of page.messages) {
      cursor = message.id;
      if (message.hidden || emittedMessageIds.has(message.id)) {
        continue;
      }
      emittedMessageIds.add(message.id);
      const summary = message.summary || message.data || "";
      await emit(message.role === "assistant" ? "agent_output" : "tool_result", browserUseMessageTitle(message), summary, {
        toolName: "browserUse",
        browserUseSessionId: sessionId,
        browserUseMessageId: message.id,
        browserUseScreenshotUrl: message.screenshotUrl ?? undefined
      });
    }
  } while (hasMore && cursor);
}

async function stopBrowserUseSession(fetchImpl: BrowserUseFetch, env: Env, sessionId: string): Promise<void> {
  await browserUseRequest(fetchImpl, env, `/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    body: { strategy: "session" }
  });
}

async function browserUseRequest(
  fetchImpl: BrowserUseFetch,
  env: Env,
  path: string,
  options: { method: "GET" | "POST"; body?: unknown }
): Promise<unknown> {
  const response = await fetchImpl(`${browserUseApiBaseUrl}${path}`, {
    method: options.method,
    headers: {
      "content-type": "application/json",
      "X-Browser-Use-API-Key": env.BROWSER_USE_API_KEY ?? ""
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    throw new Error(`Browser Use request failed with status ${response.status}: ${summarizeToolOutput(json)}`);
  }
  return json;
}

function browserUseMessageTitle(message: z.infer<typeof browserUseMessageSchema>): string {
  const role = message.role ? `${message.role.charAt(0).toUpperCase()}${message.role.slice(1)}` : "Browser";
  const type = message.type ? ` ${message.type.replaceAll("_", " ")}` : "";
  return `Browser Use ${role}${type}`.trim();
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output && typeof output === "object" && "summary" in output) {
    const summary = (output as Record<string, unknown>).summary;
    if (typeof summary === "string") {
      return summary;
    }
  }
  return output ? JSON.stringify(output) : "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
