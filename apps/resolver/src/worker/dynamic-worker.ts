import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { exaSearchInputSchema, runExaSearch } from "./code-tools";
import { formatAvailableConnections } from "./pipedream";
import { runPipedreamApiFetch } from "./pipedream";
import type { ResolutionEventEmitter, ResolverPipedreamTool } from "./types";
import { collectUrls, summarizeToolOutput } from "./utils";

function headersToRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const normalized = key.toLowerCase();
    if (normalized === "host" || normalized === "authorization" || normalized.includes("token")) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

async function requestBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }
  const text = await request.text();
  if (!text) {
    return undefined;
  }
  if (request.headers.get("content-type")?.toLowerCase().includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function createPipedreamOutboundFetcher(
  env: Env,
  emit: ResolutionEventEmitter,
  params: {
    resolutionTools: ResolverPipedreamTool[];
    externalUserId: string;
    searchedUrls: Set<string>;
  }
): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;
      const method = request.method.toUpperCase() as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        return Response.json({ error: `HTTP method ${method} is not allowed for resolver API fetches.` }, { status: 405 });
      }
      const matchedConnection = params.resolutionTools.find((connection) => {
        try {
          const hostname = new URL(url).hostname.toLowerCase();
          return hostname.includes(connection.appSlug.replaceAll("_", ""));
        } catch {
          return false;
        }
      });
      const appLabel = matchedConnection?.appName ?? "connected app";

      await emit("tool_call", `Calling ${appLabel} API`, `${method} ${url}`, {
        toolName: "executeCode",
        helper: "global.fetch",
        connectionId: matchedConnection?.connectionId ?? null,
        appSlug: matchedConnection?.appSlug ?? null,
        url,
        method
      });

      const result = await runPipedreamApiFetch(
        env,
        {
          url,
          method,
          headers: headersToRecord(request.headers),
          body: await requestBody(request)
        },
        params.resolutionTools,
        params.externalUserId
      );

      for (const foundUrl of collectUrls(result)) {
        params.searchedUrls.add(foundUrl);
      }

      if ("error" in result) {
        await emit("error", "Connected API request failed", result.error, {
          toolName: "executeCode",
          helper: "global.fetch",
          url,
          method
        });
        return Response.json(result, { status: 403 });
      }

      await emit("tool_result", `${result.appName ?? appLabel} API returned evidence`, summarizeToolOutput(result), {
        toolName: "executeCode",
        helper: "global.fetch",
        connectionId: matchedConnection?.connectionId ?? null,
        appSlug: result.appSlug,
        urls: collectUrls(result).slice(0, 10)
      });

      return new Response(result.text, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers
      });
    },
    connect: () => {
      throw new Error("TCP sockets are not allowed in resolver generated code.");
    }
  };
}

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
    globalOutbound: params.resolutionTools.length ? createPipedreamOutboundFetcher(env, emit, params) : null
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
      })
    },
    description: [
      "Write TypeScript evidence-gathering code and run it inside a sandboxed Cloudflare Dynamic Worker.",
      "",
      "Available:",
      "{{types}}",
      "",
      "The tool input must be a single async arrow function in the code field. Do not use markdown fences.",
      "Use codemode.exaSearch({ query, numResults }) for public web evidence.",
      params.resolutionTools.length
        ? `Use normal global fetch(url, init) for configured account APIs. That fetch is automatically authenticated through the selected Pipedream connection and proxied to the app API. Available connections: ${formatAvailableConnections(params.resolutionTools)}. Do not call Pipedream actions or codemode.fetch; write normal API request logic against the app's HTTP API.`
        : "No private Pipedream connections are configured for this challenge.",
      "Return structured evidence with source URLs and short summaries.",
      "",
      'Example web: async () => { const web = await codemode.exaSearch({ query: "Ben Werner Freestyle.sh current role", numResults: 5 }); return { evidence: web.results }; }',
      'Example Strava API: async () => { const me = await fetch("https://www.strava.com/api/v3/athlete"); const meText = await me.text(); if (!me.ok) throw new Error("athlete fetch failed: " + me.status + " " + meText); const athlete = JSON.parse(meText); const stats = await fetch("https://www.strava.com/api/v3/athletes/" + athlete.id + "/stats"); const statsText = await stats.text(); if (!stats.ok) throw new Error("stats fetch failed: " + stats.status + " " + statsText); const s = JSON.parse(statsText); return { athlete, ytdRunTotals: s.ytd_run_totals }; }'
    ].join("\n")
  });
}
