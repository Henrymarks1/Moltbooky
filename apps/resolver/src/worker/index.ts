import { provisionalDisputeDeadline } from "@moltbooky/core/domain/challenge";
import type { ResolutionOutcome } from "@moltbooky/core/domain/types";
import { and, challenges, createDb, eq, lte, resolutionRuns } from "@moltbooky/db";
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
  "Return YES only when the evidence clearly satisfies the claim and criteria.",
  "Return NO only when the evidence clearly contradicts the claim or criteria.",
  "Return UNRESOLVED when evidence is missing, ambiguous, inaccessible, conflicting, stale, or below the confidence threshold.",
  "Be conservative because AI resolution is provisional and users may dispute outcomes.",
  "Do not infer beyond the stated criteria. Do not settle based on popularity, vibes, or predictions.",
  "The response must be a single JSON object with outcome, confidence, sourceUrls, and shortRationale."
].join("\n");

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
  const rows = await db
    .select({
      claim: challenges.claim,
      resolutionCriteria: challenges.resolutionCriteria
    })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .limit(1);
  const challenge = rows[0];

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  const exaQuery = `${challenge.claim}\nResolution criteria: ${challenge.resolutionCriteria}`;
  const resolverResult = await runAiResolver(env, exaQuery);

  await db.insert(resolutionRuns).values({
    id: newId("res"),
    challengeId,
    exaQuery,
    sourceUrls: JSON.stringify(resolverResult.sourceUrls),
    aiRationale: resolverResult.shortRationale,
    proposedOutcome: resolverResult.outcome,
    confidence: resolverResult.confidence
  });

  if ((resolverResult.outcome === "YES" || resolverResult.outcome === "NO") && resolverResult.confidence >= 0.85) {
    await db
      .update(challenges)
      .set({
        status: "provisional_resolved",
        provisionalOutcome: resolverResult.outcome,
        disputeDeadlineAt: new Date(provisionalDisputeDeadline()),
        updatedAt: new Date()
      })
      .where(and(eq(challenges.id, challengeId), eq(challenges.status, "open")));
  }

  return resolverResult;
}

async function runAiResolver(env: Env, query: string): Promise<ResolverResult> {
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
  const result = await generateText({
    model: openai("gpt-4o-mini"),
    temperature: 0,
    stopWhen: stepCountIs(4),
    system: resolverSystemPrompt,
    prompt: ["Resolve this Moltbooky challenge.", "Use Exa for evidence, then return only the required JSON object.", "", query].join("\n"),
    tools: {
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
    }
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
