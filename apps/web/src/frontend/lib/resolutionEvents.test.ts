import { describe, expect, it } from "vitest";
import type { ResolutionEvent } from "@moltbooky/core/domain/types";
import { getLatestBrowserUseLiveUrl } from "./resolutionEvents";

function event(id: string, metadata: Record<string, unknown>, createdAt = "2026-01-01T00:00:00.000Z"): ResolutionEvent {
  return {
    id,
    challengeId: "ch_1",
    runId: "run_1",
    kind: "tool_result",
    title: "Browser event",
    body: null,
    metadata,
    createdAt
  };
}

describe("resolution event helpers", () => {
  it("returns the latest Browser Use live URL by event sequence", () => {
    const older = event("rev_1", { sequence: 1, browserUseLiveUrl: "https://live.browser-use.com?one" });
    const newer = event("rev_2", { sequence: 2, browserUseLiveUrl: "https://live.browser-use.com?two" });

    expect(getLatestBrowserUseLiveUrl([newer, older])).toBe("https://live.browser-use.com?two");
  });

  it("ignores events without Browser Use live URLs", () => {
    expect(getLatestBrowserUseLiveUrl([event("rev_1", { sequence: 1, toolName: "executeCode" })])).toBeNull();
  });
});
