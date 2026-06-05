import { z } from "zod";
import { runPipedreamApiFetch } from "./pipedream";
import type { ResolverPipedreamTool } from "./types";

export const exaSearchInputSchema = z.object({
  query: z.string().min(1).max(1000),
  numResults: z.number().int().min(1).max(10).default(5)
});

export const authenticatedFetchInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  body: z.unknown().optional(),
  app: z.string().min(1).max(80).optional(),
  connectionId: z.string().min(1).max(160).optional()
});

export async function runExaSearch(env: Env, input: unknown): Promise<unknown> {
  const parsed = exaSearchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid Exa search input." };
  }
  if (!env.EXA_API_KEY) {
    return { error: "Exa is not configured for the resolver." };
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.EXA_API_KEY
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

export async function runScopedAuthenticatedFetch(
  env: Env,
  input: unknown,
  resolutionTools: ResolverPipedreamTool[],
  externalUserId: string
): Promise<unknown> {
  const parsed = authenticatedFetchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid authenticated fetch input." };
  }

  return runPipedreamApiFetch(env, parsed.data, resolutionTools, externalUserId);
}
