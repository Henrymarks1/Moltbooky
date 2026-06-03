import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  exaSearchInputSchema,
  pipedreamRunInputSchema,
  runExaSearch,
  runScopedPipedreamAction
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
      pipedreamRun: tool({
        description:
          "Run a scoped Pipedream action for a connection selected on this bet. The connectionId must be attached to this challenge.",
        inputSchema: pipedreamRunInputSchema,
        execute: async (input) => {
          await emit("tool_call", "Calling Pipedream action", JSON.stringify({ connectionId: input.connectionId, action: input.action ?? null }), {
            toolName: "executeCode",
            helper: "codemode.pipedreamRun",
            connectionId: input.connectionId
          });
          const result = await runScopedPipedreamAction(env, input, params.resolutionTools, params.externalUserId);
          for (const url of collectUrls(result)) {
            params.searchedUrls.add(url);
          }
          await emit("tool_result", "Pipedream returned evidence", summarizeToolOutput(result), {
            toolName: "executeCode",
            helper: "codemode.pipedreamRun",
            connectionId: input.connectionId,
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
        ? `Use codemode.pipedreamRun({ connectionId, action, props }) for configured account evidence. Available connections: ${formatAvailableConnections(params.resolutionTools)}.`
        : "No private Pipedream connections are configured for this challenge.",
      "Return structured evidence with source URLs and short summaries.",
      "",
      'Example: async () => { const web = await codemode.exaSearch({ query: "Ben Werner Freestyle.sh current role", numResults: 5 }); return { evidence: web.results }; }'
    ].join("\n")
  });
}
