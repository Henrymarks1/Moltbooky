import { DynamicWorkerExecutor, normalizeCode, resolveProvider, type ExecuteResult, type Executor, type ResolvedProvider } from "@cloudflare/codemode";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { formatAvailableConnections } from "./pipedream";
import { runPipedreamApiFetch } from "./pipedream";
import type { ResolutionEventEmitter, ResolverPipedreamTool } from "./types";
import { collectUrls, summarizeToolOutput } from "./utils";

type ExecuteProviders = Parameters<Executor["execute"]>[1];

const codeModeFetchInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.unknown().optional()
});

type CodeModeToolResponse = {
  ok: boolean;
  error?: string;
  logs: string[];
  result: unknown;
};

function codeModeToolResponse(execution: ExecuteResult): CodeModeToolResponse {
  return {
    ok: !execution.error,
    ...(execution.error ? { error: execution.error } : {}),
    logs: execution.logs ?? [],
    result: execution.result
  };
}

function summarizeCodeModeExecution(response: CodeModeToolResponse): string {
  const text = JSON.stringify(response, null, 2);
  if (!text) {
    return "Generated TypeScript returned no output.";
  }
  return text;
}

function codeWithInjectedFetch(code: string): string {
  return `async () => {
  const fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const text = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const response = await codemode.fetch({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      ...(text === undefined ? {} : { body: text })
    });
    return new Response(response.text ?? "", {
      status: response.status ?? (response.ok ? 200 : 500),
      statusText: response.statusText ?? "",
      headers: response.headers ?? {}
    });
  };
  return await (${code})();
}`;
}

class ObservableCodeModeExecutor implements Executor {
  constructor(
    private readonly inner: Executor,
    private readonly emit: ResolutionEventEmitter,
    private readonly searchedUrls: Set<string>
  ) {}

  async execute(code: string, providersOrFns: ExecuteProviders): Promise<ExecuteResult> {
    const codeRunId = crypto.randomUUID();
    const startedAt = Date.now();
    await this.emit("tool_call", "Running generated TypeScript", code, {
      toolName: "executeCode",
      helper: "codemode.run",
      codeRunId,
      codeLength: code.length
    });

    let execution: ExecuteResult;
    try {
      execution = await this.inner.execute(codeWithInjectedFetch(code), providersOrFns);
    } catch (error) {
      execution = {
        result: undefined,
        error: error instanceof Error ? error.message : String(error),
        logs: []
      };
    }

    const response = codeModeToolResponse(execution);

    for (const foundUrl of collectUrls(response)) {
      this.searchedUrls.add(foundUrl);
    }

    const durationMs = Date.now() - startedAt;
    const metadata = {
      toolName: "executeCode",
      helper: "codemode.run",
      codeRunId,
      durationMs,
      logCount: response.logs.length,
      urls: collectUrls(response).slice(0, 10)
    };
    const body = summarizeCodeModeExecution(response);

    if (execution.error) {
      await this.emit("tool_result", "Generated TypeScript failed", body, {
        ...metadata,
        error: execution.error
      });
      return {
        result: response,
        logs: response.logs
      };
    }

    await this.emit("tool_result", "Generated TypeScript completed", body, metadata);
    return {
      result: response,
      logs: response.logs
    };
  }
}

function selectedConnectionLabel(url: string, resolutionTools: ResolverPipedreamTool[]): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const connection = resolutionTools.find((tool) => hostname.includes(tool.appSlug.replaceAll("_", "")));
    return connection?.appName ?? "connected app";
  } catch {
    return "connected app";
  }
}

function createCodeModeFetchTool(
  env: Env,
  emit: ResolutionEventEmitter,
  params: {
    resolutionTools: ResolverPipedreamTool[];
    externalUserId: string;
    searchedUrls: Set<string>;
  }
): Tool {
  return tool({
    description: "Internal generated-code fetch bridge. Not for direct model use.",
    inputSchema: codeModeFetchInputSchema,
    execute: async (input) => {
      const parsed = codeModeFetchInputSchema.parse(input);
      const appLabel = selectedConnectionLabel(parsed.url, params.resolutionTools);

      await emit("tool_call", `Calling ${appLabel} API`, `${parsed.method} ${parsed.url}`, {
        toolName: "executeCode",
        helper: "global.fetch",
        url: parsed.url,
        method: parsed.method
      });

      const result = await runPipedreamApiFetch(
        env,
        {
          url: parsed.url,
          method: parsed.method,
          headers: parsed.headers,
          body: parsed.body
        },
        params.resolutionTools,
        params.externalUserId
      );

      for (const foundUrl of collectUrls(result)) {
        params.searchedUrls.add(foundUrl);
      }

      if ("error" in result) {
        const response = {
          ok: false,
          status: 403,
          statusText: "Forbidden",
          headers: { "content-type": "application/json" },
          text: JSON.stringify(result),
          error: result.error
        };
        await emit("tool_result", "Connected API request failed", summarizeToolOutput(response), {
          toolName: "executeCode",
          helper: "global.fetch",
          url: parsed.url,
          method: parsed.method,
          error: result.error
        });
        return response;
      }

      await emit("tool_result", `${result.appName ?? appLabel} API returned evidence`, summarizeToolOutput(result), {
        toolName: "executeCode",
        helper: "global.fetch",
        appSlug: result.appSlug,
        urls: collectUrls(result).slice(0, 10)
      });

      return result;
    }
  });
}

function createCodeModeProviders(
  env: Env,
  emit: ResolutionEventEmitter,
  params: {
    resolutionTools: ResolverPipedreamTool[];
    externalUserId: string;
    searchedUrls: Set<string>;
  }
): ResolvedProvider[] {
  return [
    resolveProvider({
      name: "codemode",
      tools: {
        fetch: createCodeModeFetchTool(env, emit, params)
      },
      types: ""
    })
  ];
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
      execute: async ({ code }) => {
        const result = {
          ok: false,
          error: "Dynamic Worker Loader is not configured.",
          logs: [],
          result: undefined
        };
        await emit("tool_call", "Running generated TypeScript", code, {
          toolName: "executeCode",
          helper: "codemode.run",
          codeLength: code.length
        });
        await emit("tool_result", "Generated TypeScript failed", JSON.stringify(result, null, 2), {
          toolName: "executeCode",
          helper: "codemode.run",
          error: result.error
        });
        return result;
      }
    });
  }

  const executor = new ObservableCodeModeExecutor(new DynamicWorkerExecutor({
    loader: env.LOADER,
    timeout: 30_000
  }), emit, params.searchedUrls);

  const providers = createCodeModeProviders(env, emit, params);
  return tool({
    description: [
      "Write TypeScript evidence-gathering code for selected connected-account APIs and run it inside a sandboxed Cloudflare Dynamic Worker.",
      "",
      "The tool input must be a single async arrow function in the code field. Do not use markdown fences.",
      "Use normal global fetch(url, init) against the real public API host for a selected connected account.",
      "Do not add Authorization headers. Do not mention proxying, Pipedream, credentials, or internal endpoints.",
      params.resolutionTools.length
        ? `Available connected-account APIs: ${formatAvailableConnections(params.resolutionTools)}. Requests to those API hosts are authenticated automatically.`
        : "No connected-account APIs are configured for this challenge.",
      "Return structured evidence with source URLs and short summaries.",
      "",
      'Example Strava API: async () => { const me = await fetch("https://www.strava.com/api/v3/athlete"); const meText = await me.text(); if (!me.ok) throw new Error("athlete fetch failed: " + me.status + " " + meText); const athlete = JSON.parse(meText); const stats = await fetch("https://www.strava.com/api/v3/athletes/" + athlete.id + "/stats"); const statsText = await stats.text(); if (!stats.ok) throw new Error("stats fetch failed: " + stats.status + " " + statsText); const s = JSON.parse(statsText); return { athlete, ytdRunTotals: s.ytd_run_totals }; }'
    ].join("\n"),
    inputSchema: z.object({
      code: z.string().min(1)
    }),
    execute: async ({ code }) => {
      const execution = await executor.execute(normalizeCode(code), providers);
      return execution.result;
    }
  });
}
