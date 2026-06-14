import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool, hasToolCall } from "ai";
import { z } from "zod";
import { createBrowserUseTool } from "./browser-use";
import { createResolverCodeTool } from "./dynamic-worker";
import { formatAvailableConnections } from "./pipedream";
import { createWebSearchTool } from "./web-search";
import type {
  ResolutionEventEmitter,
  ResolveRequest,
  ResolverPipedreamTool,
  ResolverResult,
} from "./types";
import { summarizeToolOutput } from "./utils";

const resolverSystemPrompt = [
  "You are Moltbooky's provisional resolution agent for private-beta 1:1 challenge bets.",
  "Your job is to evaluate a binary claim against its resolution criteria using external evidence.",
  "All tokens you emit are public and visible to end users. Write concise, public-facing progress and rationale only.",
  "Use webSearch for normal public web evidence.",
  "Use browserUse only when evidence requires a real browser, JavaScript-rendered pages, page interaction, login-backed pages, or browser-visible state.",
  "Use executeCode only for selected connected-account APIs. Write a JavaScript async arrow function for Cloudflare Code Mode.",
  "Inside generated code, call the real selected app API URL with normal global fetch(url, init). Do not add auth headers.",
  "Some challenges are head-to-head between two people who each connected the same app (e.g. both GitHub). When two connected accounts share an API host, you MUST pick whose account to call by setting the request header \"x-moltbooky-connection\" to that connection's connectionId. Fetch each person's data separately, then compare to decide the winner.",
  "Generated code must not mention or know about proxying, Pipedream, credentials, tokens, or internal endpoints.",
  "Do not use imports, exports, or markdown fences in generated code.",
  "Return YES only when the evidence clearly satisfies the claim and criteria.",
  "Return NO only when the evidence clearly contradicts the claim or criteria.",
  "Use UNKNOWN when evidence is missing, ambiguous, inaccessible, conflicting, stale, or below the confidence threshold.",
  "Be conservative because AI resolution is provisional and users may dispute outcomes.",
  "Do not infer beyond the stated criteria. Do not settle based on popularity, vibes, or predictions.",
  "Your final action must be exactly one resolveBet tool call with a clear explanation paragraph.",
  "After resolveBet succeeds, do not output more content.",
].join("\n");

const resolveBetInputSchema = z.object({
  resolution: z.enum(["YES", "NO", "UNKNOWN"]),
  explanation: z.string().trim().min(1).max(4000),
});

const finalizedResultSchema = z.object({
  ok: z.boolean(),
  result: z.object({
    outcome: z.enum(["YES", "NO", "UNRESOLVED"]),
    explanation: z.string(),
    sourceUrls: z.array(z.string()).default([]),
  }),
});

export async function runAiResolver(
  env: Env,
  request: ResolveRequest,
  emit: ResolutionEventEmitter,
  query: string,
  resolutionTools: ResolverPipedreamTool[] = [],
): Promise<ResolverResult> {
  await emit(
    "run_started",
    "Resolver started",
    "Building evidence plan and preparing tools.",
  );

  if (!env.OPENAI_API_KEY) {
    await emit(
      "error",
      "Resolver model key missing",
      "The resolver model key is not configured; leaving challenge unresolved.",
    );
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: [],
      shortRationale:
        "The resolver model key is not configured; leaving challenge unresolved.",
    };
  }

  const searchedUrls = new Set<string>();
  let finalResult: ResolverResult | null = null;
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const tools: Parameters<typeof streamText>[0]["tools"] = {
    webSearch: createWebSearchTool(env, emit, {
      searchedUrls,
    }),
    executeCode: createResolverCodeTool(env, emit, {
      resolutionTools,
      searchedUrls,
    }),
    browserUse: createBrowserUseTool(env, emit, { searchedUrls }),
    resolveBet: tool({
      description:
        "Terminal tool. Finalize the bet as YES, NO, or UNKNOWN with a public explanation paragraph. This must be the last action.",
      inputSchema: z.object({
        resolution: z.enum(["YES", "NO", "UNKNOWN"]),
        explanation: z.string().trim().min(1).max(4000),
      }),
      execute: async (input) => {
        const parsed = resolveBetInputSchema.parse(input);
        const sourceUrls = Array.from(searchedUrls);
        const response = await fetch(request.finalizeCallbackUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${request.eventCallbackToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            runId: request.runId,
            resolution: parsed.resolution,
            explanation: parsed.explanation,
            confidence: parsed.resolution === "UNKNOWN" ? 0 : 1,
            sourceUrls,
          }),
        });

        const json = (await response.json().catch(() => ({}))) as unknown;
        if (!response.ok) {
          const message =
            json && typeof json === "object" && "error" in json
              ? String((json as { error: unknown }).error)
              : `Finalization failed with status ${response.status}.`;
          await emit("error", "Bet finalization failed", message, {
            toolName: "resolveBet",
          });
          return { error: message };
        }

        const finalized = finalizedResultSchema.safeParse(json);
        const outcome = finalized.success
          ? finalized.data.result.outcome
          : parsed.resolution === "UNKNOWN"
            ? "UNRESOLVED"
            : parsed.resolution;
        finalResult = {
          outcome,
          confidence: parsed.resolution === "UNKNOWN" ? 0 : 1,
          sourceUrls,
          shortRationale: parsed.explanation,
          finalized: true,
        };
        return { ok: true, outcome };
      },
    }),
  };

  const result = streamText({
    model: openai("gpt-5.5"),
    temperature: 0,
    system: resolverSystemPrompt,
    prompt: [
      "Resolve this Moltbooky challenge.",
      "All text you write is public and visible to users.",
      "Use webSearch for public internet evidence.",
      "Use browserUse only when webSearch is insufficient because a page needs browser rendering or interaction.",
      "Use executeCode only for selected connected-account APIs. In generated code, write TypeScript against the real app API and call normal fetch(url, init).",
      "Do not add Authorization headers in generated code. Do not mention proxying, Pipedream, credentials, tokens, or internal endpoints.",
      "Once you have enough evidence or know evidence is inconclusive, call resolveBet exactly once.",
      "Do not return JSON as text. The final answer must be the resolveBet tool call.",
      resolutionTools.length
        ? `Configured connected-account APIs: ${formatAvailableConnections(resolutionTools)}.`
        : "Configured connected-account APIs: none.",
      "",
      query,
    ].join("\n"),
    tools,
    stopWhen: [stepCountIs(100), hasToolCall("resolveBet")],
    onStepFinish: async (event) => {
      await emit(
        "model_step",
        "Model step finished",
        `Finish reason: ${event.finishReason}.`,
        {
          finishReason: event.finishReason,
          usage: event.usage,
        },
      );
    },
  });

  for await (const part of result.fullStream) {
    if (part.type === "start-step") {
      await emit(
        "model_step",
        "Model step started",
        "The resolver is deciding what evidence to gather next.",
      );
    } else if (part.type === "tool-input-start") {
      await emit(
        "tool_call",
        `Preparing ${part.toolName}`,
        "Choosing the tool input.",
      );
    } else if (part.type === "tool-call") {
      await emit(
        "tool_call",
        `Requested ${part.toolName}`,
        JSON.stringify(part.input, null, 2),
        { toolName: part.toolName },
      );
    } else if (part.type === "tool-result") {
      await emit(
        "tool_result",
        `${part.toolName} completed`,
        summarizeToolOutput(part.output),
        { toolName: part.toolName },
      );
    } else if (part.type === "text-delta") {
      await emit("agent_output", "Resolver note", part.text);
    } else if (part.type === "error") {
      await emit(
        "error",
        "Resolver stream error",
        part.error instanceof Error ? part.error.message : String(part.error),
      );
    }
  }

  if (!finalResult) {
    const rationale =
      "Resolver agent stopped before calling the final resolution tool. The bet was not settled.";
    await emit("error", "Resolver did not finalize", rationale);
    return {
      outcome: "UNRESOLVED",
      confidence: 0,
      sourceUrls: Array.from(searchedUrls),
      shortRationale: rationale,
      finalized: false,
    };
  }

  return finalResult;
}
