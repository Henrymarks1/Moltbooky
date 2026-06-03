import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";
import { runPipedreamAction } from "./pipedream";
import type { ResolverCodeToolProps, ResolverPipedreamTool } from "./types";

export const exaSearchInputSchema = z.object({
  query: z.string().min(1).max(1000),
  numResults: z.number().int().min(1).max(10).default(5)
});

export const pipedreamRunInputSchema = z.object({
  connectionId: z.string().min(1),
  action: z.string().min(1).max(180).optional(),
  props: z.record(z.string(), z.unknown()).default({})
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

export async function runScopedPipedreamAction(
  env: Env,
  input: unknown,
  resolutionTools: ResolverPipedreamTool[],
  externalUserId: string
): Promise<unknown> {
  const parsed = pipedreamRunInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid Pipedream action input." };
  }

  const resolutionTool = resolutionTools.find((tool) => tool.connectionId === parsed.data.connectionId || tool.appSlug === parsed.data.connectionId);
  if (!resolutionTool) {
    return { error: `Pipedream connection ${parsed.data.connectionId} is not attached to this challenge.` };
  }

  return runPipedreamAction(
    env,
    {
      ...resolutionTool,
      actionKey: parsed.data.action ?? resolutionTool.actionKey
    },
    parsed.data.props,
    externalUserId
  );
}

export class ResolverCodeTools extends WorkerEntrypoint<Env, ResolverCodeToolProps> {
  async exaSearch(input: unknown): Promise<unknown> {
    return runExaSearch(this.env, input);
  }

  async pipedreamRun(input: unknown): Promise<unknown> {
    return runScopedPipedreamAction(this.env, input, this.ctx.props.resolutionTools, this.ctx.props.externalUserId);
  }
}
