import { describe, expect, it, vi } from "vitest";
import { isBrowserUseConfigured, runBrowserUseEvidence, type BrowserUseFetch } from "./browser-use";
import type { ResolutionEventEmitter } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Browser Use evidence helper", () => {
  it("reports Browser Use as unavailable when disabled or missing a key", () => {
    expect(isBrowserUseConfigured({ BROWSER_USE_API_KEY: "key" } as Env)).toBe(true);
    expect(isBrowserUseConfigured({ BROWSER_USE_API_KEY: "key", BROWSER_USE_ENABLED: "false" } as Env)).toBe(false);
    expect(isBrowserUseConfigured({} as Env)).toBe(false);
  });

  it("emits the live URL before streamed messages and returns source URLs", async () => {
    const emitted: Array<Parameters<ResolutionEventEmitter>> = [];
    const emit: ResolutionEventEmitter = async (...event) => {
      emitted.push(event);
    };
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST" && path.endsWith("/sessions")) {
        return jsonResponse({
          id: "bus_1",
          status: "running",
          liveUrl: "https://live.browser-use.com?wss=abc",
          recordingUrls: [],
          screenshotUrl: "https://browser-use.example/screenshot.png"
        });
      }
      if (init?.method === "GET" && path.includes("/messages")) {
        return jsonResponse({
          messages: [
            {
              id: "msg_1",
              role: "assistant",
              type: "browser_navigate",
              summary: "Navigating to the source page",
              screenshotUrl: "https://browser-use.example/step.png"
            }
          ],
          hasMore: false
        });
      }
      if (init?.method === "GET" && path.endsWith("/sessions/bus_1")) {
        return jsonResponse({
          id: "bus_1",
          status: "idle",
          liveUrl: "https://live.browser-use.com?wss=abc",
          output: {
            summary: "Found the evidence.",
            sourceUrls: ["https://example.com/evidence"]
          },
          recordingUrls: ["https://browser-use.example/recording.mp4"]
        });
      }
      if (init?.method === "POST" && path.endsWith("/sessions/bus_1/stop")) {
        return jsonResponse({ id: "bus_1", status: "stopped" });
      }
      return jsonResponse({ error: "unexpected request" }, 404);
    }) as unknown as BrowserUseFetch;

    const result = await runBrowserUseEvidence(
      { BROWSER_USE_API_KEY: "bu_test" } as Env,
      { task: "Check the page", startUrl: "https://example.com" },
      emit,
      { fetchImpl, maxPolls: 2, pollDelayMs: 0 }
    );

    expect(result.ok).toBe(true);
    expect(result.liveUrl).toBe("https://live.browser-use.com?wss=abc");
    expect(result.sourceUrls).toContain("https://example.com/evidence");
    expect(fetchImpl).toHaveBeenCalledWith("https://api.browser-use.com/api/v3/sessions/bus_1/stop", expect.any(Object));

    const liveEventIndex = emitted.findIndex((event) => event[1] === "Browser live view ready");
    const messageEventIndex = emitted.findIndex((event) => event[3]?.browserUseMessageId === "msg_1");
    expect(liveEventIndex).toBeGreaterThan(-1);
    expect(messageEventIndex).toBeGreaterThan(liveEventIndex);
  });

  it("attempts to stop the Browser Use session after a polling error", async () => {
    const emit = vi.fn<ResolutionEventEmitter>(async () => {});
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "POST" && path.endsWith("/sessions")) {
        return jsonResponse({ id: "bus_2", status: "running", liveUrl: "https://live.browser-use.com?wss=def" });
      }
      if (init?.method === "GET" && path.includes("/messages")) {
        return jsonResponse({ error: "poll failed" }, 500);
      }
      if (init?.method === "POST" && path.endsWith("/sessions/bus_2/stop")) {
        return jsonResponse({ id: "bus_2", status: "stopped" });
      }
      return jsonResponse({ error: "unexpected request" }, 404);
    }) as unknown as BrowserUseFetch;

    const result = await runBrowserUseEvidence({ BROWSER_USE_API_KEY: "bu_test" } as Env, { task: "Check the page" }, emit, {
      fetchImpl,
      maxPolls: 1,
      pollDelayMs: 0
    });

    expect(result.ok).toBe(false);
    expect(result.sessionId).toBe("bus_2");
    expect(fetchImpl).toHaveBeenCalledWith("https://api.browser-use.com/api/v3/sessions/bus_2/stop", expect.any(Object));
  });
});
