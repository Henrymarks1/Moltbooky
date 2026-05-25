import { provisionalDisputeDeadline } from "../domain/challenge";
import type { ResolutionOutcome } from "../domain/types";
import { newId } from "./db";

export interface ResolverResult {
  outcome: ResolutionOutcome;
  confidence: number;
  sourceUrls: string[];
  shortRationale: string;
}

export async function enqueueOpenChallenges(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM challenges WHERE status = 'open' AND expires_at <= datetime('now') LIMIT 50"
  ).all<{ id: string }>();

  for (const row of results) {
    await env.RESOLUTION_QUEUE.send({ challengeId: row.id });
  }

  return results.length;
}

export async function resolveChallenge(env: Env, challengeId: string): Promise<ResolverResult> {
  const challenge = await env.DB.prepare(
    "SELECT claim, resolution_criteria as resolutionCriteria FROM challenges WHERE id = ?"
  )
    .bind(challengeId)
    .first<{ claim: string; resolutionCriteria: string }>();

  if (!challenge) {
    throw new Error("Challenge not found.");
  }

  const exaQuery = `${challenge.claim}\nResolution criteria: ${challenge.resolutionCriteria}`;
  const result = await runAiResolver(env, exaQuery);

  await env.DB.prepare(
    "INSERT INTO resolution_runs (id, challenge_id, exa_query, source_urls, ai_rationale, proposed_outcome, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      newId("res"),
      challengeId,
      exaQuery,
      JSON.stringify(result.sourceUrls),
      result.shortRationale,
      result.outcome,
      result.confidence
    )
    .run();

  if ((result.outcome === "YES" || result.outcome === "NO") && result.confidence >= 0.85) {
    await env.DB.prepare(
      "UPDATE challenges SET status = 'provisional_resolved', provisional_outcome = ?, dispute_deadline_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'"
    )
      .bind(result.outcome, provisionalDisputeDeadline(), challengeId)
      .run();
  }

  return result;
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

  const searchResponse = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.EXA_API_KEY
    },
    body: JSON.stringify({ query, numResults: 5, type: "auto" })
  });
  const searchJson = (await searchResponse.json()) as { results?: Array<{ url?: string; title?: string; text?: string }> };
  const sources = searchJson.results ?? [];

  const llmResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Resolve challenge bets from web evidence. Return JSON with outcome YES, NO, or UNRESOLVED; confidence 0-1; source_urls; short_rationale. Be conservative."
        },
        {
          role: "user",
          content: JSON.stringify({ query, sources })
        }
      ]
    })
  });
  const llmJson = (await llmResponse.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = llmJson.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Partial<ResolverResult> & { source_urls?: string[]; short_rationale?: string };

  return {
    outcome: parsed.outcome === "YES" || parsed.outcome === "NO" ? parsed.outcome : "UNRESOLVED",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    sourceUrls: parsed.sourceUrls ?? parsed.source_urls ?? sources.flatMap((source) => (source.url ? [source.url] : [])),
    shortRationale: parsed.shortRationale ?? parsed.short_rationale ?? "No rationale returned."
  };
}
