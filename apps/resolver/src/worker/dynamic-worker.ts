import { z } from "zod";
import type { ResolverExecutionContext, ResolverPipedreamTool } from "./types";

const executeCodeResultSchema = z.object({
  result: z.unknown().optional(),
  events: z
    .array(
      z.object({
        kind: z.enum(["tool_call", "tool_result", "agent_output", "error"]),
        title: z.string(),
        body: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
    )
    .default([])
});

export type ExecuteCodeResult = z.infer<typeof executeCodeResultSchema>;

function dynamicWorkerHostSource(): string {
  return `
import run from "./agent";

function summarize(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text && text.length > 500 ? text.slice(0, 500) + "..." : text;
}

function urlsFrom(value, urls = []) {
  if (!value) return urls;
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\\/\\/[^\\s"'<>]+/g)) urls.push(match[0]);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) urlsFrom(item, urls);
    return urls;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) urlsFrom(item, urls);
  }
  return urls;
}

export default {
  async fetch(_request, env) {
    const events = [];
    const ctx = {
      exa: {
        search: async (input) => {
          events.push({ kind: "tool_call", title: "Calling Exa web search", body: input?.query ?? null, metadata: { helper: "ctx.exa.search" } });
          const result = await env.RESOLVER_TOOLS.exaSearch(input);
          events.push({ kind: "tool_result", title: "Exa returned evidence", body: summarize(result), metadata: { helper: "ctx.exa.search", urls: urlsFrom(result).slice(0, 10) } });
          return result;
        }
      },
      pipedream: {
        run: async (input) => {
          events.push({ kind: "tool_call", title: "Calling Pipedream action", body: JSON.stringify({ connectionId: input?.connectionId, action: input?.action ?? null }), metadata: { helper: "ctx.pipedream.run", connectionId: input?.connectionId } });
          const result = await env.RESOLVER_TOOLS.pipedreamRun(input);
          events.push({ kind: "tool_result", title: "Pipedream returned evidence", body: summarize(result), metadata: { helper: "ctx.pipedream.run", connectionId: input?.connectionId, urls: urlsFrom(result).slice(0, 10) } });
          return result;
        }
      },
      log: (message, data) => {
        events.push({ kind: "agent_output", title: String(message), body: data === undefined ? null : summarize(data), metadata: { helper: "ctx.log" } });
      }
    };

    try {
      const result = await run(ctx);
      return Response.json({ result, events });
    } catch (error) {
      events.push({ kind: "error", title: "Resolver code failed", body: error instanceof Error ? error.message : String(error), metadata: { helper: "executeCode" } });
      return Response.json({ result: { error: error instanceof Error ? error.message : String(error) }, events }, { status: 500 });
    }
  }
};
`;
}

export async function executeResolverCode(
  env: Env,
  ctx: ResolverExecutionContext,
  params: {
    code: string;
    resolutionTools: ResolverPipedreamTool[];
    externalUserId: string;
  }
): Promise<ExecuteCodeResult> {
  if (!env.LOADER) {
    return {
      result: { error: "Dynamic Worker Loader is not configured." },
      events: [{ kind: "error", title: "Dynamic Worker Loader missing", body: "Configure the resolver worker LOADER binding before running generated code." }]
    };
  }

  const { createWorker } = await import("@cloudflare/worker-bundler");
  const bundled = await createWorker({
    files: {
      "src/index.ts": dynamicWorkerHostSource(),
      "src/agent.ts": params.code,
      "package.json": JSON.stringify({ dependencies: {} })
    },
    entryPoint: "src/index.ts",
    bundle: true,
    minify: false,
    target: "es2022"
  });

  const worker = env.LOADER.load({
    mainModule: bundled.mainModule,
    modules: bundled.modules,
    compatibilityDate: "2026-05-30",
    globalOutbound: null,
    env: {
      RESOLVER_TOOLS: ctx.exports.ResolverCodeTools({
        props: {
          resolutionTools: params.resolutionTools,
          externalUserId: params.externalUserId
        }
      })
    }
  });

  const response = await withTimeout(
    worker.getEntrypoint().fetch(new Request("https://resolver-code.local/run", { method: "POST" })),
    20_000,
    "Generated resolver code timed out."
  );
  const json = (await response.json().catch(() => ({}))) as unknown;
  const parsed = executeCodeResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      result: { error: "Generated resolver code returned an invalid response." },
      events: [{ kind: "error", title: "Invalid resolver code response", body: "The Dynamic Worker did not return the expected result envelope." }]
    };
  }
  return parsed.data;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
