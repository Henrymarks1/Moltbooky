import { createOpenAI } from "@ai-sdk/openai";
import type { ChallengeKind } from "@moltbooky/core/domain/types";
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

// Evidence-gathering rules shared by every challenge type (tool selection is NOT here — each
// prompt names its own single terminal tool, since only that one is loaded for the agent).
const sharedEvidenceRules = [
  "All tokens you emit are public and visible to end users. Write concise, public-facing progress and rationale only.",
  "Use webSearch for normal public web evidence.",
  "Use browserUse only when evidence requires a real browser, JavaScript-rendered pages, page interaction, login-backed pages, or browser-visible state.",
  "Use executeCode only for selected connected-account APIs. Write a JavaScript async arrow function for Cloudflare Code Mode.",
  "Inside generated code, call the real selected app API URL with normal global fetch(url, init). Do not add auth headers.",
  "Generated code must not mention or know about proxying, Pipedream, credentials, tokens, or internal endpoints.",
  "Do not use imports, exports, or markdown fences in generated code.",
  "Be conservative because AI resolution is provisional and users may dispute outcomes.",
];

// Open prediction-market bets: a binary YES/NO claim judged against its criteria. The ONLY
// terminal tool loaded is resolveBet.
const openMatchSystemPrompt = [
  "You are Moltbooky's provisional resolution agent for private-beta prediction bets.",
  "Your job is to evaluate a binary claim against its resolution criteria using external evidence.",
  ...sharedEvidenceRules,
  "You have exactly one terminal tool: resolveBet. Finalize by calling resolveBet once with resolution = YES, NO, or UNKNOWN and a clear public explanation paragraph.",
  "Return YES only when the evidence clearly satisfies the claim and criteria.",
  "Return NO only when the evidence clearly contradicts the claim or criteria.",
  "Use UNKNOWN when evidence is missing, ambiguous, inaccessible, conflicting, stale, or below the confidence threshold.",
  "Do not infer beyond the stated criteria. Do not settle based on popularity, vibes, or predictions.",
  "After resolveBet succeeds, do not output more content.",
].join("\n");

// Head-to-head challenges: a comparison between two people. The ONLY terminal tool loaded is
// resolveChallenge, which takes a winner's user id — the agent never reasons in YES/NO.
const headToHeadSystemPrompt = [
  "You are Moltbooky's provisional resolution agent for private-beta head-to-head challenges between two people: the creator and their opponent.",
  "The claim is a comparison written from the creator's point of view (e.g. \"I will run more miles than my opponent this week\"). Your job is to measure the relevant metric for BOTH people and decide WHO WINS under the resolution criteria.",
  "Think and write entirely in terms of the two named people — never YES/NO.",
  ...sharedEvidenceRules,
  "Each person connected their own account. When two connected accounts share an API host (e.g. both GitHub), you MUST pick whose account to call by setting the request header \"x-moltbooky-connection\" to that connection's connectionId. The available connections are labeled with whose they are (creator vs opponent).",
  "Always fetch the creator's data and the opponent's data in SEPARATE calls, compute each person's value, and compare them explicitly in your explanation (state both numbers).",
  "You have exactly one terminal tool: resolveChallenge. Finalize by calling resolveChallenge once with winnerId set to the winning person's user id, or \"TIE\" if you cannot measure one or both people or it is a genuine tie the criteria don't break.",
  "Do not infer beyond the stated criteria. Decide strictly on the measured comparison, not on reputation or guesses.",
  "After resolveChallenge succeeds, do not output more content.",
].join("\n");

function resolverSystemPromptFor(kind: ChallengeKind): string {
  return kind === "head_to_head" ? headToHeadSystemPrompt : openMatchSystemPrompt;
}

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
  kind: ChallengeKind = "open_match",
  competitors?: { creatorId: string; creatorName: string; opponentId: string; opponentName: string },
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
  const isHeadToHead = kind === "head_to_head";
  const terminalToolName = isHeadToHead ? "resolveChallenge" : "resolveBet";

  // Shared finalize call: both terminal tools translate their input to a YES/NO/UNKNOWN outcome
  // and POST to the same finalize endpoint (settlement is YES=creator-wins / NO=opponent-wins).
  async function finalizeOutcome(resolution: "YES" | "NO" | "UNKNOWN", explanation: string) {
    const sourceUrls = Array.from(searchedUrls);
    const response = await fetch(request.finalizeCallbackUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.eventCallbackToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        runId: request.runId,
        resolution,
        explanation,
        confidence: resolution === "UNKNOWN" ? 0 : 1,
        sourceUrls,
      }),
    });

    const json = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      const message =
        json && typeof json === "object" && "error" in json
          ? String((json as { error: unknown }).error)
          : `Finalization failed with status ${response.status}.`;
      await emit("error", "Finalization failed", message, { toolName: terminalToolName });
      return { error: message };
    }

    const finalized = finalizedResultSchema.safeParse(json);
    const outcome = finalized.success ? finalized.data.result.outcome : resolution === "UNKNOWN" ? "UNRESOLVED" : resolution;
    finalResult = {
      outcome,
      confidence: resolution === "UNKNOWN" ? 0 : 1,
      sourceUrls,
      shortRationale: explanation,
      finalized: true,
    };
    return { ok: true, outcome };
  }

  // Head-to-head finalizes by WINNER USER ID, not YES/NO. Translate id -> outcome here.
  const headToHeadTerminalTool = tool({
    description: `Terminal tool. Finalize the head-to-head challenge by choosing the WINNER. Pass winnerId = "${competitors?.creatorId ?? "<creatorId>"}" if ${competitors?.creatorName?.trim() || "the creator"} wins, or winnerId = "${competitors?.opponentId ?? "<opponentId>"}" if ${competitors?.opponentName?.trim() || "the opponent"} wins. Pass winnerId = "TIE" only if neither can be measured or it is a genuine tie. The explanation is public — write it about the people (their names, each measured value, and who won). This must be the last action.`,
    inputSchema: z.object({
      winnerId: z.string().min(1).describe('The winning user id, or "TIE" if undecidable.'),
      explanation: z.string().trim().min(1).max(4000),
    }),
    execute: async (input) => {
      const winnerId = String(input.winnerId).trim();
      let resolution: "YES" | "NO" | "UNKNOWN";
      if (winnerId === competitors?.creatorId) {
        resolution = "YES";
      } else if (winnerId === competitors?.opponentId) {
        resolution = "NO";
      } else if (winnerId.toUpperCase() === "TIE" || winnerId.toUpperCase() === "UNKNOWN") {
        resolution = "UNKNOWN";
      } else {
        const message = `winnerId "${winnerId}" is not one of the two competitors. Use "${competitors?.creatorId}" (${competitors?.creatorName}) or "${competitors?.opponentId}" (${competitors?.opponentName}), or "TIE".`;
        await emit("error", "Invalid winner", message, { toolName: terminalToolName });
        return { error: message };
      }
      const result = await finalizeOutcome(resolution, input.explanation);
      return "error" in result ? result : { ok: true, winnerId: resolution === "UNKNOWN" ? "TIE" : winnerId };
    },
  });

  const openMatchTerminalTool = tool({
    description: "Terminal tool. Finalize the bet as YES, NO, or UNKNOWN with a public explanation paragraph. This must be the last action.",
    inputSchema: z.object({
      resolution: z.enum(["YES", "NO", "UNKNOWN"]),
      explanation: z.string().trim().min(1).max(4000),
    }),
    execute: async (input) => {
      const parsed = resolveBetInputSchema.parse(input);
      return finalizeOutcome(parsed.resolution, parsed.explanation);
    },
  });

  const tools: Parameters<typeof streamText>[0]["tools"] = {
    webSearch: createWebSearchTool(env, emit, {
      searchedUrls,
    }),
    executeCode: createResolverCodeTool(env, emit, {
      resolutionTools,
      searchedUrls,
    }),
    browserUse: createBrowserUseTool(env, emit, { searchedUrls }),
    [terminalToolName]: isHeadToHead ? headToHeadTerminalTool : openMatchTerminalTool,
  };

  // Name the two competitors so the agent reasons and writes about people, not YES/NO.
  const creator = competitors?.creatorName?.trim() || "the creator";
  const opponent = competitors?.opponentName?.trim() || "the opponent";
  const result = streamText({
    model: openai("gpt-5.5"),
    temperature: 0,
    system: resolverSystemPromptFor(kind),
    prompt: [
      isHeadToHead ? `Resolve this Moltbooky head-to-head challenge between ${creator} and ${opponent}.` : "Resolve this Moltbooky prediction bet.",
      isHeadToHead
        ? `${creator} is the creator (their connected accounts are labeled "creator"); ${opponent} is the opponent (labeled "opponent"). Decide who wins.`
        : "",
      "All text you write is public and visible to users.",
      "Use webSearch for public internet evidence.",
      "Use browserUse only when webSearch is insufficient because a page needs browser rendering or interaction.",
      "Use executeCode only for selected connected-account APIs. In generated code, write TypeScript against the real app API and call normal fetch(url, init).",
      "Do not add Authorization headers in generated code. Do not mention proxying, Pipedream, credentials, tokens, or internal endpoints.",
      isHeadToHead
        ? `Measure the relevant metric for BOTH ${creator} and ${opponent} in separate calls. Write your explanation about the PEOPLE — name ${creator} and ${opponent}, give each person's measured value, and state who won. Then call resolveChallenge once with winnerId set to the winner's user id (${creator} = "${competitors?.creatorId}", ${opponent} = "${competitors?.opponentId}"), or "TIE" if undecidable.`
        : "Once you have enough evidence or know evidence is inconclusive, call resolveBet exactly once.",
      `Do not return JSON as text. The final answer must be the ${terminalToolName} tool call.`,
      resolutionTools.length
        ? `Configured connected-account APIs: ${formatAvailableConnections(resolutionTools)}.`
        : "Configured connected-account APIs: none.",
      "",
      query,
    ].filter(Boolean).join("\n"),
    tools,
    stopWhen: [stepCountIs(100), hasToolCall(terminalToolName)],
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
