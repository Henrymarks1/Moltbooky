import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createFrontendClient } from "@pipedream/sdk/browser";
import { CheckCircle2, CircleDollarSign, Globe2, Link2, Search, Sparkles, TimerReset } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { api, type ChallengeDraft, type PipedreamApp, type PipedreamConnection } from "../lib/api";
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
  iconSrc?: string;
  iconFallback: string;
  summary: string;
  defaultInstructions: string;
};

const resolverToolPresets: ResolverToolPreset[] = [
  {
    id: "linkedin",
    appSlug: "linkedin",
    appName: "LinkedIn",
    authPropName: "linkedin",
    actionKey: "linkedin-get-profile",
    iconFallback: "in",
    summary: "Profile and company signals",
    defaultInstructions: "Use LinkedIn only to verify profile or company facts relevant to this market."
  },
  {
    id: "github",
    appSlug: "github",
    appName: "GitHub",
    authPropName: "github",
    actionKey: "github-get-repository",
    iconFallback: "GH",
    summary: "Repos, commits, releases",
    defaultInstructions: "Use GitHub only to verify repository, release, issue, or commit evidence relevant to this market."
  },
  {
    id: "strava",
    appSlug: "strava",
    appName: "Strava",
    authPropName: "strava",
    actionKey: "strava-list-activities",
    iconFallback: "S",
    summary: "Activities, distances, routes",
    defaultInstructions: "Use Strava only to verify activities relevant to this market."
  },
  {
    id: "slack",
    appSlug: "slack",
    appName: "Slack",
    authPropName: "slack",
    actionKey: "slack-fetch-conversation-history",
    iconFallback: "S",
    summary: "Channels, messages, workspace activity",
    defaultInstructions: "Use Slack only to verify workspace messages or channel evidence relevant to this market."
  },
  {
    id: "gmail",
    appSlug: "gmail",
    appName: "Gmail",
    authPropName: "gmail",
    actionKey: "gmail-search-emails",
    iconFallback: "G",
    summary: "Emails, senders, timestamps",
    defaultInstructions: "Use Gmail only to verify email evidence relevant to this market."
  },
  {
    id: "google-drive",
    appSlug: "google_drive",
    appName: "Google Drive",
    authPropName: "google_drive",
    actionKey: "google_drive-search-files",
    iconFallback: "GD",
    summary: "Files, folders, documents",
    defaultInstructions: "Use Google Drive only to verify file or document evidence relevant to this market."
  },
  {
    id: "google-calendar",
    appSlug: "google_calendar",
    appName: "Google Calendar",
    authPropName: "google_calendar",
    actionKey: "google_calendar-list-events",
    iconFallback: "GC",
    summary: "Events, schedules, attendees",
    defaultInstructions: "Use Google Calendar only to verify event or schedule evidence relevant to this market."
  }
];

const resolverToolPresetsBySlug = new Map(resolverToolPresets.map((tool) => [tool.appSlug, tool]));
const defaultResolverToolSlugs = resolverToolPresets.map((tool) => tool.appSlug);

function appFallback(name: string): string {
  const words = name.replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "?";
}

function appToResolverTool(app: PipedreamApp): ResolverToolPreset {
  const preset = resolverToolPresetsBySlug.get(app.nameSlug);
  return {
    id: app.nameSlug,
    appSlug: app.nameSlug,
    appName: app.name,
    authPropName: preset?.authPropName ?? app.nameSlug,
    actionKey: preset?.actionKey ?? `${app.nameSlug}-make-api-request`,
    iconSrc: app.imgSrc,
    iconFallback: appFallback(app.name),
    summary: preset?.summary ?? app.categories?.slice(0, 2).join(", ") ?? app.authType ?? "Pipedream connection",
    defaultInstructions: preset?.defaultInstructions ?? `Use ${app.name} only to verify evidence relevant to this market.`
  };
}

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
  const [claim, setClaim] = useState(draftClaim);
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [stakeCredits, setStakeCredits] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [creatorSide, setCreatorSide] = useState<"YES" | "NO">("YES");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [connectingPipedream, setConnectingPipedream] = useState(false);
  const [pipedreamStatus, setPipedreamStatus] = useState("");
  const [connectError, setConnectError] = useState("");
  const [pipedreamConnections, setPipedreamConnections] = useState<PipedreamConnection[]>([]);
  const [pipedreamApps, setPipedreamApps] = useState<PipedreamApp[]>([]);
  const [pipedreamAppsLoading, setPipedreamAppsLoading] = useState(false);
  const [pipedreamAppsError, setPipedreamAppsError] = useState("");
  const [appSearch, setAppSearch] = useState("");
  const [visibleToolLimit, setVisibleToolLimit] = useState(90);
  const [draftReady, setDraftReady] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const resolverTools = useMemo(() => {
    if (!pipedreamApps.length) {
      return resolverToolPresets;
    }
    const toolsBySlug = new Map(pipedreamApps.map((app) => [app.nameSlug, appToResolverTool(app)]));
    const toolsByName = new Map(pipedreamApps.map((app) => [app.name.toLowerCase(), appToResolverTool(app)]));
    const pinnedTools = defaultResolverToolSlugs
      .map((slug) => {
        const preset = resolverToolPresetsBySlug.get(slug);
        return toolsBySlug.get(slug) ?? (preset ? toolsByName.get(preset.appName.toLowerCase()) : undefined) ?? preset;
      })
      .filter((tool): tool is ResolverToolPreset => Boolean(tool));
    const pinnedSlugs = new Set(pinnedTools.map((tool) => tool.appSlug));
    const pinnedNames = new Set(pinnedTools.map((tool) => tool.appName.toLowerCase()));
    return [...pinnedTools, ...pipedreamApps.filter((app) => !pinnedSlugs.has(app.nameSlug) && !pinnedNames.has(app.name.toLowerCase())).map(appToResolverTool)];
  }, [pipedreamApps]);
  const visibleResolverTools = resolverTools.slice(0, visibleToolLimit);
  const connectionsById = useMemo(() => new Map(pipedreamConnections.map((connection) => [connection.id, connection])), [pipedreamConnections]);
  const connectionsByAppSlug = useMemo(() => new Map(pipedreamConnections.map((connection) => [connection.appSlug, connection])), [pipedreamConnections]);
  const selectedConnections = selectedConnectionIds.map((id) => connectionsById.get(id)).filter((connection): connection is PipedreamConnection => Boolean(connection));

  const draft = useMemo<ChallengeDraft>(() => {
    return { claim, resolutionCriteria, creatorSide, visibility, stakeCredits, expiresAt, pipedreamConnectionIds: selectedConnectionIds };
  }, [claim, creatorSide, expiresAt, resolutionCriteria, selectedConnectionIds, stakeCredits, visibility]);

  useEffect(() => {
    setVisibleToolLimit(90);
  }, [appSearch]);

  useEffect(() => {
    let cancelled = false;
    api
      .getChallengeDraft()
      .then(({ challenge }) => {
        if (cancelled || !challenge) {
          return;
        }
        const saved = challenge.draft;
        setClaim(saved.claim ?? "");
        setResolutionCriteria(saved.resolutionCriteria ?? "");
        setCreatorSide(saved.creatorSide ?? "YES");
        setVisibility(saved.visibility ?? "public");
        setStakeCredits(saved.stakeCredits ?? "");
        setExpiresAt(saved.expiresAt ?? "");
        setSelectedConnectionIds(saved.pipedreamConnectionIds ?? []);
      })
      .catch(() => {
        // Drafts require auth; an anonymous user can still compose until publish redirects.
      })
      .finally(() => {
        if (!cancelled) {
          setDraftReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .listPipedreamConnections()
      .then(({ connections }) => {
        if (!cancelled) {
          setPipedreamConnections(connections);
        }
      })
      .catch(() => {
        // The app directory is useful before sign-in; saved connections require an authenticated user.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPipedreamAppsLoading(true);
    setPipedreamAppsError("");
    api
      .listPipedreamApps(appSearch)
      .then(({ apps }) => {
        if (!cancelled) {
          setPipedreamApps(apps);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPipedreamAppsError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPipedreamAppsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appSearch]);

  useEffect(() => {
    if (!draftReady) {
      return;
    }
    const handle = window.setTimeout(() => {
      void api.saveChallengeDraft(draft).catch(() => {
        // Autosave should never block composing a market.
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [draft, draftReady]);

  async function selectResolverTool(tool: ResolverToolPreset) {
    setConnectError("");
    setPipedreamStatus("");
    setError("");
    const savedConnection = connectionsByAppSlug.get(tool.appSlug);
    if (savedConnection) {
      setSelectedConnectionIds((ids) => (ids.includes(savedConnection.id) ? ids : [...ids, savedConnection.id]));
      setPipedreamStatus(`${savedConnection.appName} added to this agent.`);
      return;
    }

    setConnectingPipedream(true);
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
          void api
            .savePipedreamConnection({
              appSlug: tool.appSlug,
              appName: tool.appName,
              accountId: id,
              authPropName: tool.authPropName
            })
            .then(({ connection }) => {
              setPipedreamConnections((connections) => {
                const withoutCurrentApp = connections.filter((item) => item.appSlug !== connection.appSlug);
                return [...withoutCurrentApp, connection];
              });
              setSelectedConnectionIds((ids) => (ids.includes(connection.id) ? ids : [...ids, connection.id]));
              setPipedreamStatus(`${connection.appName} connected and added to this agent.`);
            })
            .catch((err) => {
              setConnectError((err as Error).message);
            });
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
      const { challenge } = await api.createChallenge({
        claim: String(form.get("claim") ?? ""),
        resolutionCriteria: String(form.get("resolutionCriteria") ?? ""),
        pipedreamConnectionIds: selectedConnectionIds,
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
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            required
          />
        </Label>
        <Label>
          Resolution criteria
          <Textarea
            name="resolutionCriteria"
            placeholder="Resolve YES only if OpenAI announces general availability on its official site or API docs before the expiry."
            value={resolutionCriteria}
            onChange={(event) => setResolutionCriteria(event.target.value)}
            required
          />
        </Label>
        <div className="tool-picker">
            <div className="tool-picker-header">
              <div>
                <span>Give the resolver evidence access</span>
                <small>{appSearch.trim() ? `${pipedreamApps.length.toLocaleString()} matching apps` : "Popular Pipedream apps"}</small>
              </div>
              <strong>Click to add to agent</strong>
            </div>
            <div className="agent-tool-strip">
              <span className="agent-tool-label">Agent tools</span>
              <div className="agent-tool-pill always-on">
                <Sparkles size={14} />
                <span>Exa web search</span>
              </div>
              {selectedConnections.map((connection) => {
                const preset = resolverToolPresetsBySlug.get(connection.appSlug);
                return (
                  <div className="agent-tool-pill" key={connection.id}>
                    <span className="agent-tool-logo">
                      <em>{preset?.iconFallback ?? appFallback(connection.appName)}</em>
                    </span>
                    <span>{connection.appName}</span>
                  </div>
                );
              })}
              {selectedConnectionIds.length > selectedConnections.length && (
                <div className="agent-tool-pill">
                  <span>{selectedConnectionIds.length - selectedConnections.length} saved connection{selectedConnectionIds.length - selectedConnections.length === 1 ? "" : "s"}</span>
                </div>
              )}
            </div>
            <label className="tool-search">
              <Search size={16} />
              <Input
                value={appSearch}
                onChange={(event) => setAppSearch(event.target.value)}
                placeholder="Search Pipedream apps"
                type="search"
              />
            </label>
            <div
              className="tool-card-grid"
              onScroll={(event) => {
                const target = event.currentTarget;
                if (target.scrollTop + target.clientHeight >= target.scrollHeight - 120) {
                  setVisibleToolLimit((limit) => Math.min(limit + 90, resolverTools.length));
                }
              }}
            >
              {visibleResolverTools.map((tool) => (
                (() => {
                  const savedConnection = connectionsByAppSlug.get(tool.appSlug);
                  const isAdded = Boolean(savedConnection && selectedConnectionIds.includes(savedConnection.id));
                  return (
                  <button
                    type="button"
                    key={tool.id}
                    className={isAdded ? "tool-card selected" : "tool-card"}
                    onClick={() => selectResolverTool(tool)}
                    disabled={connectingPipedream}
                    aria-pressed={isAdded}
                  >
                    <span className="tool-card-icon">
                      {tool.iconSrc ? (
                        <img src={tool.iconSrc} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                      ) : (
                        <em>{tool.iconFallback}</em>
                      )}
                    </span>
                    <span className="tool-card-body">
                      <span className="tool-card-title">
                        <strong>{tool.appName}</strong>
                        {savedConnection && <span className="tool-chip">Connected</span>}
                      </span>
                      <small>{tool.summary}</small>
                    </span>
                  </button>
                  );
                })()
              ))}
              {!resolverTools.length && (
                <div className="tool-empty">
                  <strong>No matching apps</strong>
                  <span>Try a different search.</span>
                </div>
              )}
            </div>
            {resolverTools.length > visibleResolverTools.length && (
              <p className="tool-count">Showing {visibleResolverTools.length.toLocaleString()} of {resolverTools.length.toLocaleString()} apps. Scroll for more.</p>
            )}
            {pipedreamAppsLoading && <p className="tool-status">Loading Pipedream app directory...</p>}
            {pipedreamAppsError && <p className="tool-error">{pipedreamAppsError}</p>}
            {pipedreamStatus && <p className="tool-status"><Link2 size={15} /> {pipedreamStatus}</p>}
            {connectError && <p className="tool-error">{connectError}</p>}
        </div>
        <div className="two-col">
          <Label>
            <span><CircleDollarSign size={15} /> Stake</span>
            <Input name="stakeCredits" inputMode="decimal" placeholder="25.00" value={stakeCredits} onChange={(event) => setStakeCredits(event.target.value)} required />
          </Label>
          <Label>
            <span><TimerReset size={15} /> Expiry</span>
            <Input name="expiresAt" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required />
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
