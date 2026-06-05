import { afterEach, describe, expect, it, vi } from "vitest";
import { runScopedAuthenticatedFetch } from "./code-tools";
import type { ResolverPipedreamTool } from "./types";

const stravaTool: ResolverPipedreamTool = {
  type: "pipedream_action",
  connectionId: "pdc_strava",
  appSlug: "strava",
  appName: "Strava",
  authPropName: "strava",
  accountId: "apn_strava",
  actionKey: "strava-api-proxy"
};

describe("runScopedAuthenticatedFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards selected app API requests through the Pipedream proxy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "pd_token" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 123, firstname: "Henry" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runScopedAuthenticatedFetch(
      {
        PIPEDREAM_CLIENT_ID: "client",
        PIPEDREAM_CLIENT_SECRET: "secret",
        PIPEDREAM_PROJECT_ID: "proj_123",
        PIPEDREAM_PROJECT_ENVIRONMENT: "development"
      } as Env,
      {
        app: "strava",
        url: "https://www.strava.com/api/v3/athlete",
        method: "GET"
      },
      [stravaTool],
      "user_123"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(tokenRequest).toMatchObject({ scope: "connect:*" });

    const proxyUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(proxyUrl.pathname).toMatch(/^\/v1\/connect\/proj_123\/proxy\//);
    const encodedTargetUrl = proxyUrl.pathname.split("/").at(-1);
    expect(encodedTargetUrl ? atob(decodeURIComponent(encodedTargetUrl)) : "").toBe("https://www.strava.com/api/v3/athlete");
    expect(proxyUrl.searchParams.get("external_user_id")).toBe("user_123");
    expect(proxyUrl.searchParams.get("account_id")).toBe("apn_strava");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        authorization: "Bearer pd_token",
        "x-pd-environment": "development"
      }
    });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      json: { id: 123, firstname: "Henry" },
      appSlug: "strava",
      appName: "Strava"
    });
  });

  it("rejects API requests for connections that were not selected on the bet", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runScopedAuthenticatedFetch(
      {
        PIPEDREAM_CLIENT_ID: "client",
        PIPEDREAM_CLIENT_SECRET: "secret",
        PIPEDREAM_PROJECT_ID: "proj_123"
      } as Env,
      {
        app: "github",
        url: "https://api.github.com/user/repos",
        method: "GET"
      },
      [stravaTool],
      "user_123"
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: expect.stringContaining("No selected connected-account API")
    });
  });
});
