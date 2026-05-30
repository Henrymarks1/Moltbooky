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
import { cn } from "../lib/utils";
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
const noticeErrorClass = "rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive";
const toolCardClass =
  "grid min-h-[92px] grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg border bg-card p-3 text-left text-card-foreground transition-colors hover:border-primary/40 hover:bg-background disabled:cursor-wait disabled:opacity-70";
const toolIconClass =
  "relative grid h-11 w-11 place-items-center overflow-hidden rounded-lg border bg-background text-xs font-black text-muted-foreground [&_img]:relative [&_img]:z-10 [&_img]:h-6 [&_img]:w-6 [&_img]:object-contain [&_em]:absolute [&_em]:text-xs [&_em]:font-black [&_em]:not-italic";
const segmentedClass =
  "grid grid-cols-2 rounded-lg bg-muted p-1 [&_button]:inline-flex [&_button]:h-10 [&_button]:items-center [&_button]:justify-center [&_button]:gap-2 [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-sm [&_button]:font-medium [&_button]:text-muted-foreground [&_button]:transition-colors";

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
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex items-start justify-between gap-4 [&_h1]:max-w-[850px] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-2xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">New market</Badge>
            <Badge variant="outline">Even odds</Badge>
          </div>
          <h1>Launch a market in under a minute.</h1>
          <p>Post a claim, choose your side, and lock platform credits for matching.</p>
        </div>
      </header>

      <form className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4 max-[920px]:grid-cols-1" onSubmit={submit}>
        <Card className="grid gap-3">
          <CardHeader>
            <CardTitle>Market details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
        {error && <div className={noticeErrorClass}>{error}</div>}
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
        <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-semibold uppercase text-muted-foreground">Give the resolver evidence access</span>
                <small className="mt-1 block text-sm text-muted-foreground">{appSearch.trim() ? `${pipedreamApps.length.toLocaleString()} matching apps` : "Popular Pipedream apps"}</small>
              </div>
              <strong className="text-base font-semibold">Click to add to agent</strong>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Agent tools</span>
              <div className="inline-flex h-8 items-center gap-2 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
                <Sparkles size={14} />
                <span>Exa web search</span>
              </div>
              {selectedConnections.map((connection) => {
                const preset = resolverToolPresetsBySlug.get(connection.appSlug);
                return (
                  <div className="inline-flex h-8 items-center gap-2 rounded-full border bg-muted px-3 text-xs font-semibold text-foreground" key={connection.id}>
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-background text-[10px] font-black text-muted-foreground">
                      <em>{preset?.iconFallback ?? appFallback(connection.appName)}</em>
                    </span>
                    <span>{connection.appName}</span>
                  </div>
                );
              })}
              {selectedConnectionIds.length > selectedConnections.length && (
                <div className="inline-flex h-8 items-center gap-2 rounded-full border bg-muted px-3 text-xs font-semibold text-foreground">
                  <span>{selectedConnectionIds.length - selectedConnections.length} saved connection{selectedConnectionIds.length - selectedConnections.length === 1 ? "" : "s"}</span>
                </div>
              )}
            </div>
            <label className="relative block [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:left-3 [&_svg]:top-1/2 [&_svg]:z-10 [&_svg]:-translate-y-1/2 [&_svg]:text-muted-foreground [&_input]:pl-9">
              <Search size={16} />
              <Input
                value={appSearch}
                onChange={(event) => setAppSearch(event.target.value)}
                placeholder="Search Pipedream apps"
                type="search"
              />
            </label>
            <div
              className="grid max-h-[420px] grid-cols-3 gap-3 overflow-auto pr-1 max-[980px]:grid-cols-2 max-[560px]:grid-cols-1"
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
                    className={cn(toolCardClass, isAdded && "border-primary bg-background ring-2 ring-primary/10")}
                    onClick={() => selectResolverTool(tool)}
                    disabled={connectingPipedream}
                    aria-pressed={isAdded}
                  >
                    <span className={toolIconClass}>
                      {tool.iconSrc ? (
                        <img src={tool.iconSrc} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                      ) : (
                        <em>{tool.iconFallback}</em>
                      )}
                    </span>
                    <span className="grid min-w-0 gap-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <strong className="truncate text-sm font-semibold">{tool.appName}</strong>
                        {savedConnection && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">Connected</span>}
                      </span>
                      <small className="truncate text-xs font-medium text-muted-foreground">{tool.summary}</small>
                    </span>
                  </button>
                  );
                })()
              ))}
              {!resolverTools.length && (
                <div className="col-span-full grid gap-1 rounded-lg border border-dashed bg-card p-4 text-center text-sm text-muted-foreground [&_strong]:text-foreground">
                  <strong>No matching apps</strong>
                  <span>Try a different search.</span>
                </div>
              )}
            </div>
            {resolverTools.length > visibleResolverTools.length && (
              <p className="text-xs font-medium text-muted-foreground">Showing {visibleResolverTools.length.toLocaleString()} of {resolverTools.length.toLocaleString()} apps. Scroll for more.</p>
            )}
            {pipedreamAppsLoading && <p className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground">Loading Pipedream app directory...</p>}
            {pipedreamAppsError && <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm leading-6 text-destructive">{pipedreamAppsError}</p>}
            {pipedreamStatus && <p className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground"><Link2 size={15} /> {pipedreamStatus}</p>}
            {connectError && <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm leading-6 text-destructive">{connectError}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          <Label>
            <span className="inline-flex items-center gap-1.5"><CircleDollarSign size={15} /> Stake</span>
            <Input name="stakeCredits" inputMode="decimal" placeholder="25.00" value={stakeCredits} onChange={(event) => setStakeCredits(event.target.value)} required />
          </Label>
          <Label>
            <span className="inline-flex items-center gap-1.5"><TimerReset size={15} /> Expiry</span>
            <Input name="expiresAt" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required />
            <small className="text-xs font-medium text-muted-foreground">Uses your local timezone and saves as UTC.</small>
          </Label>
        </div>
          </CardContent>
        </Card>

        <Card className="grid gap-3">
          <CardHeader>
            <CardTitle>Position and access</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
        <div className="grid gap-2 rounded-lg border bg-muted p-4 text-foreground">
          <span className="text-sm text-muted-foreground">Creator position</span>
          <strong className="text-3xl font-semibold leading-none tracking-tight">{creatorSide}</strong>
          <p className="text-sm leading-6 text-muted-foreground">The counterparty receives the opposite side at the same stake.</p>
        </div>
        <div className={segmentedClass} role="group" aria-label="Creator side">
          <button type="button" className={creatorSide === "YES" ? "bg-background text-foreground shadow-sm" : ""} onClick={() => setCreatorSide("YES")}>
            YES
          </button>
          <button type="button" className={creatorSide === "NO" ? "bg-background text-foreground shadow-sm" : ""} onClick={() => setCreatorSide("NO")}>
            NO
          </button>
        </div>
        <div className="grid gap-2 rounded-lg border bg-muted p-4 text-foreground">
          <span className="text-sm text-muted-foreground">{visibility === "public" ? "Public bet" : "Private bet"}</span>
          <strong className="text-3xl font-semibold leading-none tracking-tight">{visibility === "public" ? "Listed" : "Share link"}</strong>
          <p className="text-sm leading-6 text-muted-foreground">
            {visibility === "public"
              ? "Visible in the public market feed and accessible by link."
              : "Hidden from the public feed. Anyone with the share link can open it."}
          </p>
        </div>
        <div className={segmentedClass} role="group" aria-label="Bet visibility">
          <button type="button" className={visibility === "public" ? "bg-background text-foreground shadow-sm" : ""} onClick={() => setVisibility("public")}>
            <Globe2 size={16} /> Public
          </button>
          <button type="button" className={visibility === "private" ? "bg-background text-foreground shadow-sm" : ""} onClick={() => setVisibility("private")}>
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
