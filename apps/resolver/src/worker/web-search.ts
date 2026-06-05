import { tool, type Tool } from "ai";
import { runExaSearch, exaSearchInputSchema } from "./code-tools";
import type { ResolutionEventEmitter } from "./types";
import { collectUrls } from "./utils";

export function createWebSearchTool(
  env: Env,
  _emit: ResolutionEventEmitter,
  params: {
    searchedUrls: Set<string>;
  }
): Tool {
  return tool({
    description: [
      "Search the public web for evidence and source URLs.",
      "Use this for normal public internet evidence before using Browser Use.",
      "Do not use this for selected connected-account APIs."
    ].join(" "),
    inputSchema: exaSearchInputSchema,
    execute: async (input) => {
      const result = await runExaSearch(env, input);
      for (const url of collectUrls(result)) {
        params.searchedUrls.add(url);
      }
      return result;
    }
  });
}
