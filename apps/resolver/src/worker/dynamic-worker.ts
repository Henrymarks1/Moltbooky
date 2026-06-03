import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  authenticatedFetchInputSchema,
  exaSearchInputSchema,
  runExaSearch,
  runScopedAuthenticatedFetch
} from "./code-tools";
import { formatAvailableConnections } from "./pipedream";
import type { ResolutionEventEmitter, ResolverPipedreamTool } from "./types";
import { collectUrls, summarizeToolOutput } from "./utils";

export function createResolverCodeTool(
  env: Env,
  emit: ResolutionEventEmitter,
  params: {
    resolutionTools: ResolverPipedreamTool[];
    externalUserId: string;
    searchedUrls: Set<string>;
  }
): Tool {
  if (!env.LOADER) {
    return tool({
      description: "Run generated evidence-gathering code. This tool is unavailable because the Worker Loader binding is missing.",
      inputSchema: z.object({
        code: z.string().min(1)
      }),
      execute: async () => {
        const result = { error: "Dynamic Worker Loader is not configured." };
        await emit("error", "Dynamic Worker Loader missing", "Configure the resolver worker LOADER binding before running generated code.", {
          toolName: "executeCode"
        });
        return { result, logs: [] };
      }
    });
  }

  const executor = new DynamicWorkerExecutor({
    loader: env.LOADER,
    timeout: 30_000,
    globalOutbound: null
  });

  return createCodeTool({
    executor,
    tools: {
      exaSearch: tool({
        description: "Search the public web through Exa. Use this for public evidence and source URLs.",
        inputSchema: exaSearchInputSchema,
        execute: async (input) => {
          await emit("tool_call", "Calling Exa web search", input.query, {
            toolName: "executeCode",
            helper: "codemode.exaSearch"
          });
          const result = await runExaSearch(env, input);
          for (const url of collectUrls(result)) {
            params.searchedUrls.add(url);
          }
          await emit("tool_result", "Exa returned evidence", summarizeToolOutput(result), {
            toolName: "executeCode",
            helper: "codemode.exaSearch",
            urls: collectUrls(result).slice(0, 10)
          });
          return result;
        }
      }),
      fetch: tool({
        description:
          "Forward an authenticated HTTP request through a selected Pipedream connection. Use this to call the connected app's real API.",
        inputSchema: authenticatedFetchInputSchema,
        execute: async (input) => {
          const connection = params.resolutionTools.find((tool) => tool.connectionId === input.connectionId || tool.appSlug === input.app);
          const appLabel = connection?.appName ?? input.app ?? input.connectionId ?? "connected app";
          await emit("tool_call", `Calling ${appLabel} API`, input.url, {
            toolName: "executeCode",
            helper: "codemode.fetch",
            connectionId: input.connectionId ?? connection?.connectionId ?? null,
            appSlug: input.app ?? connection?.appSlug ?? null,
            url: input.url,
            method: input.method ?? "GET"
          });
          const result = await runScopedAuthenticatedFetch(env, input, params.resolutionTools, params.externalUserId);
          for (const url of collectUrls(result)) {
            params.searchedUrls.add(url);
          }
          const resultApp = result && typeof result === "object" && "appName" in result ? String((result as { appName?: unknown }).appName ?? appLabel) : appLabel;
          await emit("tool_result", `${resultApp} API returned evidence`, summarizeToolOutput(result), {
            toolName: "executeCode",
            helper: "codemode.fetch",
            connectionId: input.connectionId ?? connection?.connectionId ?? null,
            appSlug: input.app ?? connection?.appSlug ?? null,
            urls: collectUrls(result).slice(0, 10)
          });
          return result;
        }
      })
    },
    description: [
      "Write JavaScript evidence-gathering code and run it inside a sandboxed Cloudflare Dynamic Worker.",
      "",
      "Available:",
      "{{types}}",
      "",
      "Write an async arrow function. Do not use TypeScript annotations, interfaces, or markdown fences.",
      "Use codemode.exaSearch({ query, numResults }) for public web evidence.",
      params.resolutionTools.length
        ? `Use codemode.fetch({ app, connectionId, url, method, params, headers, body }) for configured account APIs. Available connections: ${formatAvailableConnections(params.resolutionTools)}. Do not use Pipedream actions; write normal API request logic against the app's HTTP API.`
        : "No private Pipedream connections are configured for this challenge.",
      "Return structured evidence with source URLs and short summaries.",
      "",
      'Example web: async () => { const web = await codemode.exaSearch({ query: "Ben Werner Freestyle.sh current role", numResults: 5 }); return { evidence: web.results }; }',
      'Example Strava API: async () => { const me = await codemode.fetch({ app: "strava", url: "https://www.strava.com/api/v3/athlete" }); if (!me.ok) throw new Error("athlete fetch failed: " + me.status + " " + me.text); const athlete = me.json; const stats = await codemode.fetch({ app: "strava", url: "https://www.strava.com/api/v3/athletes/" + athlete.id + "/stats" }); if (!stats.ok) throw new Error("stats fetch failed: " + stats.status + " " + stats.text); return { athlete, stats: stats.json }; }'
    ].join("\n")
  });
}
