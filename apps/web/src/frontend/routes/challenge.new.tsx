import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { createFrontendClient } from "@pipedream/sdk/browser";
import { CheckCircle2, CircleDollarSign, Globe2, Link2, TimerReset } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { api } from "../lib/api";
import { draftClaimKey } from "../lib/drafts";
import { authChangeEvent } from "./root";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "challenge/new",
  component: NewChallenge
});

type ResolverToolPreset = {
  id: string;
  appSlug: string;
  appName: string;
  authPropName: string;
  actionKey: string;
  iconSrc: string;
  iconFallback: string;
  tint: string;
  summary: string;
  defaultInstructions: string;
};

const resolverToolPresets: ResolverToolPreset[] = [
  {
    id: "strava",
    appSlug: "strava",
    appName: "Strava",
    authPropName: "strava",
    actionKey: "strava-list-activities",
    iconSrc: "https://cdn.simpleicons.org/strava/FC4C02",
    iconFallback: "S",
    tint: "#fc4c02",
    summary: "Activities, distances, routes",
    defaultInstructions: "Use Strava only to verify activities relevant to this market."
  },
  {
    id: "linkedin",
    appSlug: "linkedin",
    appName: "LinkedIn",
    authPropName: "linkedin",
    actionKey: "linkedin-get-profile",
    iconSrc: "https://cdn.simpleicons.org/linkedin/0A66C2",
    iconFallback: "in",
    tint: "#0a66c2",
    summary: "Profile and company signals",
    defaultInstructions: "Use LinkedIn only to verify profile or company facts relevant to this market."
  },
  {
    id: "github",
    appSlug: "github",
    appName: "GitHub",
    authPropName: "github",
    actionKey: "github-get-repository",
    iconSrc: "https://cdn.simpleicons.org/github/181717",
    iconFallback: "GH",
    tint: "#181717",
    summary: "Repos, commits, releases",
    defaultInstructions: "Use GitHub only to verify repository, release, issue, or commit evidence relevant to this market."
  },
  {
    id: "fitbit",
    appSlug: "fitbit",
    appName: "Fitbit",
    authPropName: "fitbit",
    actionKey: "fitbit-get-activities",
    iconSrc: "https://cdn.simpleicons.org/fitbit/00B0B9",
    iconFallback: "F",
    tint: "#00b0b9",
    summary: "Health and activity data",
    defaultInstructions: "Use Fitbit only to verify activity or health data relevant to this market."
  },
  {
    id: "google-sheets",
    appSlug: "google_sheets",
    appName: "Google Sheets",
    authPropName: "google_sheets",
    actionKey: "google_sheets-get-values",
    iconSrc: "https://cdn.simpleicons.org/googlesheets/34A853",
    iconFallback: "G",
    tint: "#34a853",
    summary: "Rows, records, calculations",
    defaultInstructions: "Use Google Sheets only to verify spreadsheet values relevant to this market."
  },
  {
    id: "notion",
    appSlug: "notion",
    appName: "Notion",
    authPropName: "notion",
    actionKey: "notion-search",
    iconSrc: "https://cdn.simpleicons.org/notion/000000",
    iconFallback: "N",
    tint: "#111827",
    summary: "Pages and database records",
    defaultInstructions: "Use Notion only to verify pages or database records relevant to this market."
  }
];

function toIsoDateTime(value: FormDataEntryValue | null): string {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function NewChallenge() {
  const navigate = useNavigate();
  const [draftClaim] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const draft = window.sessionStorage.getItem(draftClaimKey) ?? "";
    window.sessionStorage.removeItem(draftClaimKey);
    return draft;
  });
  const [creatorSide, setCreatorSide] = useState<"YES" | "NO">("YES");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [connectingPipedream, setConnectingPipedream] = useState(false);
  const [pipedreamStatus, setPipedreamStatus] = useState("");
  const [connectError, setConnectError] = useState("");
  const [connectedAccountIds, setConnectedAccountIds] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedTool = resolverToolPresets.find((tool) => tool.id === selectedToolId) ?? null;

  async function selectResolverTool(tool: ResolverToolPreset) {
    setSelectedToolId(tool.id);
    setConnectingPipedream(true);
    setConnectError("");
    setPipedreamStatus("");
    setError("");
    try {
      const initialToken = await api.createPipedreamConnectToken();
      const client = createFrontendClient({
        externalUserId: initialToken.externalUserId,
        token: initialToken.token,
        tokenCallback: async () => {
          const freshToken = await api.createPipedreamConnectToken();
          return {
            token: freshToken.token,
            expiresAt: freshToken.expiresAt ? new Date(freshToken.expiresAt) : new Date(Date.now() + 3 * 60 * 60 * 1000),
            connectLinkUrl: freshToken.connectLinkUrl ?? ""
          };
        }
      });

      await client.connectAccount({
        app: tool.appSlug,
        onSuccess: ({ id }) => {
          setConnectedAccountIds((accounts) => ({ ...accounts, [tool.id]: id }));
          setPipedreamStatus(`${tool.appName} connected.`);
        },
        onError: (err) => {
          setConnectError(err.message);
        },
        onClose: (status) => {
          setConnectingPipedream(false);
          if (!status.successful && !status.completed) {
            setPipedreamStatus(`${tool.appName} connection was closed.`);
          }
        }
      });
    } catch (err) {
      const message = (err as Error).message;
      if (message.toLowerCase().includes("sign in")) {
        await navigate({ to: "/login" });
        return;
      }
      setConnectError(
        message.includes("BETTER_AUTH_SECRET")
          ? "Local auth is not configured for account connections. Add BETTER_AUTH_SECRET to apps/api/.dev.vars, or run the API with your main dev vars file."
          : message.includes("/api/integrations/pipedream/connect-token")
            ? "Could not reach the Pipedream connection service. Start the API worker locally and try again."
          : message
      );
    } finally {
      if (!document.querySelector("iframe[title='Pipedream Connect']")) {
        setConnectingPipedream(false);
      }
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      let configuredProps: Record<string, unknown> | undefined;
      const configuredPropsRaw = String(form.get("pipedreamConfiguredProps") ?? "").trim();
      if (configuredPropsRaw) {
        const parsed = JSON.parse(configuredPropsRaw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Pipedream default props must be a JSON object.");
        }
        configuredProps = parsed as Record<string, unknown>;
      }

      const resolutionTool = selectedTool
        ? {
            type: "pipedream_action" as const,
            appSlug: String(form.get("pipedreamAppSlug") ?? selectedTool.appSlug).trim(),
            appName: String(form.get("pipedreamAppName") ?? selectedTool.appName).trim() || selectedTool.appName,
            authPropName: String(form.get("pipedreamAuthPropName") ?? selectedTool.authPropName).trim(),
            accountId: String(form.get("pipedreamAccountId") ?? "").trim() || undefined,
            actionKey: String(form.get("pipedreamActionKeyOverride") || form.get("pipedreamActionKey") || selectedTool.actionKey).trim(),
            configuredProps,
            instructions: String(form.get("pipedreamInstructions") ?? "").trim() || selectedTool.defaultInstructions
          }
        : null;

      const { challenge } = await api.createChallenge({
        claim: String(form.get("claim") ?? ""),
        resolutionCriteria: String(form.get("resolutionCriteria") ?? ""),
        resolutionTool,
        creatorSide,
        visibility,
        stakeCredits: String(form.get("stakeCredits") ?? ""),
        expiresAt: toIsoDateTime(form.get("expiresAt"))
      });
      window.dispatchEvent(new Event(authChangeEvent));
      await navigate({ to: "/challenge/$id", params: { id: challenge.id } });
    } catch (err) {
      const message = (err as Error).message;
      if (message.toLowerCase().includes("sign in")) {
        await navigate({ to: "/login" });
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page create-page">
      <header className="page-header">
        <div>
          <div className="row-meta">
            <Badge variant="outline">New market</Badge>
            <Badge variant="outline">Even odds</Badge>
          </div>
          <h1>Launch a market in under a minute.</h1>
          <p>Post a claim, choose your side, and lock platform credits for matching.</p>
        </div>
      </header>

      <form className="create-layout" onSubmit={submit}>
        <Card className="form">
          <CardHeader>
            <CardTitle>Market details</CardTitle>
          </CardHeader>
          <CardContent className="form">
        {error && <div className="notice error">{error}</div>}
        <Label>
          Claim
          <Textarea
            name="claim"
            placeholder="I bet YES that OpenAI launches a new model by June 30, 2026."
            defaultValue={draftClaim}
            required
          />
        </Label>
        <Label>
          Resolution criteria
          <Textarea
            name="resolutionCriteria"
            placeholder="Resolve YES only if OpenAI announces general availability on its official site or API docs before the expiry."
            required
          />
        </Label>
        <div className="tool-picker">
          {selectedTool && (
            <>
              <input type="hidden" name="pipedreamAppSlug" value={selectedTool.appSlug} />
              <input type="hidden" name="pipedreamAppName" value={selectedTool.appName} />
              <input type="hidden" name="pipedreamAuthPropName" value={selectedTool.authPropName} />
              <input type="hidden" name="pipedreamActionKey" value={selectedTool.actionKey} />
              <input type="hidden" name="pipedreamAccountId" value={connectedAccountIds[selectedTool.id] ?? ""} />
            </>
          )}
            <div className="tool-picker-header">
              <span>Give the resolver evidence access</span>
              <strong>{selectedTool?.appName ?? "Web search only"}</strong>
            </div>
            <div className="tool-card-grid">
              {resolverToolPresets.map((tool) => (
                <button
                  type="button"
                  key={tool.id}
                  className={selectedToolId === tool.id ? "tool-card selected" : "tool-card"}
                  onClick={() => selectResolverTool(tool)}
                  disabled={connectingPipedream}
                  aria-pressed={selectedToolId === tool.id}
                >
                  <span className="tool-card-icon" style={{ "--tool-color": tool.tint } as React.CSSProperties}>
                    <em>{tool.iconFallback}</em>
                    <img src={tool.iconSrc} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                  </span>
                  <span>
                    <strong>{tool.appName}</strong>
                    <small>{tool.summary}</small>
                  </span>
                </button>
              ))}
            </div>
            {pipedreamStatus && <p className="tool-status"><Link2 size={15} /> {pipedreamStatus}</p>}
            {connectError && <p className="tool-error">{connectError}</p>}
            {selectedTool && <details className="tool-advanced">
              <summary>Advanced resolver settings</summary>
              <div className="two-col">
                <Label>
                  Connected account ID
                  <Input value={connectedAccountIds[selectedTool.id] ?? ""} placeholder="Filled after authorization" readOnly />
                </Label>
                <Label>
                  Action key
                  <Input name="pipedreamActionKeyOverride" placeholder={selectedTool.actionKey} />
                </Label>
              </div>
            </details>}
            {selectedTool && (
              <>
                <Label>
                  Default props JSON
                  <Textarea name="pipedreamConfiguredProps" placeholder={'{"before": "2026-06-30T23:59:00Z"}'} />
                </Label>
                <Label>
                  Resolver instructions
                  <Textarea name="pipedreamInstructions" placeholder={selectedTool.defaultInstructions} />
                </Label>
              </>
            )}
        </div>
        <div className="two-col">
          <Label>
            <span><CircleDollarSign size={15} /> Stake</span>
            <Input name="stakeCredits" inputMode="decimal" placeholder="25.00" required />
          </Label>
          <Label>
            <span><TimerReset size={15} /> Expiry</span>
            <Input name="expiresAt" type="datetime-local" required />
            <small className="field-help">Uses your local timezone and saves as UTC.</small>
          </Label>
        </div>
          </CardContent>
        </Card>

        <Card className="form">
          <CardHeader>
            <CardTitle>Position and access</CardTitle>
          </CardHeader>
          <CardContent className="form">
        <div className="composer-ticket">
          <span>Creator position</span>
          <strong>{creatorSide}</strong>
          <p>The counterparty receives the opposite side at the same stake.</p>
        </div>
        <div className="segmented side-segmented" role="group" aria-label="Creator side">
          <button type="button" className={creatorSide === "YES" ? "selected yes" : ""} onClick={() => setCreatorSide("YES")}>
            YES
          </button>
          <button type="button" className={creatorSide === "NO" ? "selected no" : ""} onClick={() => setCreatorSide("NO")}>
            NO
          </button>
        </div>
        <div className="composer-ticket">
          <span>{visibility === "public" ? "Public bet" : "Private bet"}</span>
          <strong>{visibility === "public" ? "Listed" : "Share link"}</strong>
          <p>
            {visibility === "public"
              ? "Visible in the public market feed and accessible by link."
              : "Hidden from the public feed. Anyone with the share link can open it."}
          </p>
        </div>
        <div className="segmented visibility-segmented" role="group" aria-label="Bet visibility">
          <button type="button" className={visibility === "public" ? "selected" : ""} onClick={() => setVisibility("public")}>
            <Globe2 size={16} /> Public
          </button>
          <button type="button" className={visibility === "private" ? "selected" : ""} onClick={() => setVisibility("private")}>
            <Link2 size={16} /> Private
          </button>
        </div>
        <Button type="submit" disabled={loading}>
          <CheckCircle2 size={18} /> {loading ? "Publishing..." : "Publish challenge"}
        </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
