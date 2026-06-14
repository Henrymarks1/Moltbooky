import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFrontendClient } from "@pipedream/sdk/browser";
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, CircleDollarSign, Globe2, Link2, Search, Sparkles, TimerReset } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Slider } from "../components/ui/slider";
import { Textarea } from "../components/ui/textarea";
import { api, type PipedreamApp, type PipedreamConnection } from "../lib/api";
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
    defaultInstructions: "Use LinkedIn only to verify profile or company facts relevant to this bet."
  },
  {
    id: "github",
    appSlug: "github",
    appName: "GitHub",
    authPropName: "github",
    actionKey: "github-get-repository",
    iconFallback: "GH",
    summary: "Repos, commits, releases",
    defaultInstructions: "Use GitHub only to verify repository, release, issue, or commit evidence relevant to this bet."
  },
  {
    id: "strava",
    appSlug: "strava",
    appName: "Strava",
    authPropName: "strava",
    actionKey: "strava-list-activities",
    iconFallback: "S",
    summary: "Activities, distances, routes",
    defaultInstructions: "Use Strava only to verify activities relevant to this bet."
  },
  {
    id: "slack",
    appSlug: "slack",
    appName: "Slack",
    authPropName: "slack",
    actionKey: "slack-fetch-conversation-history",
    iconFallback: "S",
    summary: "Channels, messages, workspace activity",
    defaultInstructions: "Use Slack only to verify workspace messages or channel evidence relevant to this bet."
  },
  {
    id: "gmail",
    appSlug: "gmail",
    appName: "Gmail",
    authPropName: "gmail",
    actionKey: "gmail-search-emails",
    iconFallback: "G",
    summary: "Emails, senders, timestamps",
    defaultInstructions: "Use Gmail only to verify email evidence relevant to this bet."
  },
  {
    id: "google-drive",
    appSlug: "google_drive",
    appName: "Google Drive",
    authPropName: "google_drive",
    actionKey: "google_drive-search-files",
    iconFallback: "GD",
    summary: "Files, folders, documents",
    defaultInstructions: "Use Google Drive only to verify file or document evidence relevant to this bet."
  },
  {
    id: "google-calendar",
    appSlug: "google_calendar",
    appName: "Google Calendar",
    authPropName: "google_calendar",
    actionKey: "google_calendar-list-events",
    iconFallback: "GC",
    summary: "Events, schedules, attendees",
    defaultInstructions: "Use Google Calendar only to verify event or schedule evidence relevant to this bet."
  }
];

const resolverToolPresetsBySlug = new Map(resolverToolPresets.map((tool) => [tool.appSlug, tool]));
const defaultResolverToolSlugs = resolverToolPresets.map((tool) => tool.appSlug);
const noticeErrorClass = "rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive";
const toolCardClass =
  "grid min-h-[68px] grid-cols-[34px_minmax(0,1fr)] items-center gap-2 rounded-md border bg-card p-2 text-left text-card-foreground transition-colors hover:border-primary/40 hover:bg-background disabled:cursor-wait disabled:opacity-70";
const toolIconClass =
  "relative grid h-8 w-8 place-items-center overflow-hidden rounded-md border bg-background text-[10px] font-black text-muted-foreground [&_img]:relative [&_img]:z-10 [&_img]:h-5 [&_img]:w-5 [&_img]:object-contain [&_em]:absolute [&_em]:text-[10px] [&_em]:font-black [&_em]:not-italic";
const segmentedClass =
  "grid grid-cols-2 rounded-md border bg-muted/70 p-1 [&_button]:inline-flex [&_button]:h-9 [&_button]:items-center [&_button]:justify-center [&_button]:gap-2 [&_button]:rounded-[5px] [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-sm [&_button]:font-semibold [&_button]:text-muted-foreground [&_button]:transition-colors hover:[&_button]:bg-background/70 hover:[&_button]:text-foreground";
const wizardStepClass = "mx-auto grid w-full max-w-xl gap-4";
const chipIconClass =
  "grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-background/80 text-[10px] font-black text-muted-foreground [&_img]:h-4 [&_img]:w-4 [&_img]:object-contain [&_em]:not-italic";

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
    defaultInstructions: preset?.defaultInstructions ?? `Use ${app.name} only to verify evidence relevant to this bet.`
  };
}

function iconMapFromApps(apps: PipedreamApp[]): Record<string, string> {
  return Object.fromEntries(apps.filter((app) => app.imgSrc).map((app) => [app.nameSlug, app.imgSrc!]));
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function nextHalfHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const remainder = minutes % 30;
  if (remainder > 0) {
    rounded.setMinutes(minutes + 30 - remainder);
  }
  return rounded;
}

function defaultExpiryParts(): { date: string; time: string } {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return parseExpiry(nextHalfHour(tomorrow).toISOString());
}

function parseExpiry(value?: string): { date: string; time: string } {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) {
    const fallback = nextHalfHour(new Date());
    fallback.setDate(fallback.getDate() + 1);
    return { date: toDateInputValue(fallback), time: toTimeInputValue(fallback) };
  }

  const rounded = nextHalfHour(date);
  return { date: toDateInputValue(rounded), time: toTimeInputValue(rounded) };
}

function expiryPartsToIso(dateValue: string, timeValue: string): string {
  const date = new Date(`${dateValue}T${timeValue}:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

const expiryTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? 0 : 30;
  const value = `${padDatePart(hours)}:${padDatePart(minutes)}`;
  const labelDate = new Date(2026, 0, 1, hours, minutes);
  return {
    value,
    label: labelDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase()
  };
});

type NewChallengeProps = {
  initialClaim?: string;
};

export function NewChallenge({ initialClaim = "" }: NewChallengeProps = {}) {
  const navigate = useNavigate();
  const [claim, setClaim] = useState(initialClaim);
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [stakeCredits, setStakeCredits] = useState("25");
  const [expiryDate, setExpiryDate] = useState(() => defaultExpiryParts().date);
  const [expiryTime, setExpiryTime] = useState(() => defaultExpiryParts().time);
  const [creatorSide, setCreatorSide] = useState<"YES" | "NO">("YES");
  const [mode, setMode] = useState<"open_match" | "head_to_head">("open_match");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [connectingPipedream, setConnectingPipedream] = useState(false);
  const [pipedreamStatus, setPipedreamStatus] = useState("");
  const [connectError, setConnectError] = useState("");
  const [pipedreamConnections, setPipedreamConnections] = useState<PipedreamConnection[]>([]);
  const [pipedreamApps, setPipedreamApps] = useState<PipedreamApp[]>([]);
  const [pipedreamAppsLoading, setPipedreamAppsLoading] = useState(false);
  const [pipedreamAppsError, setPipedreamAppsError] = useState("");
  const [appIconSrcBySlug, setAppIconSrcBySlug] = useState<Record<string, string>>({});
  const [appSearch, setAppSearch] = useState("");
  const [visibleToolLimit, setVisibleToolLimit] = useState(90);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const publishRequestedRef = useRef(false);

  useEffect(() => {
    setClaim(initialClaim);
  }, [initialClaim]);

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
  const connectionsById = useMemo(() => new Map(pipedreamConnections.map((connection) => [connection.id, connection])), [pipedreamConnections]);
  const connectionsByAppSlug = useMemo(() => new Map(pipedreamConnections.map((connection) => [connection.appSlug, connection])), [pipedreamConnections]);
  const selectedConnections = selectedConnectionIds.map((id) => connectionsById.get(id)).filter((connection): connection is PipedreamConnection => Boolean(connection));
  const expiresAt = useMemo(() => expiryPartsToIso(expiryDate, expiryTime), [expiryDate, expiryTime]);
  const stakeAmount = Number(stakeCredits);
  const isHeadToHead = mode === "head_to_head";
  const hasBetDetails = Boolean(claim.trim() && resolutionCriteria.trim());
  const hasTerms = Boolean(Number.isFinite(stakeAmount) && stakeAmount >= 5 && expiryDate && expiryTime && expiresAt);
  // Head-to-head needs at least one required app so both people can connect the same account.
  const hasRequiredApps = !isHeadToHead || selectedConnections.length > 0;
  const canPublish = Boolean(hasBetDetails && hasTerms && hasRequiredApps);
  const resolverToolsForView = resolverTools.slice(0, appSearch.trim() ? visibleToolLimit : 8);
  const exaIconSrc = appIconSrcBySlug.exa;
  const browserUseIconSrc = appIconSrcBySlug.browser_use ?? appIconSrcBySlug["browser-use"] ?? appIconSrcBySlug.browseruse;
  const steps = [
    { title: "Write the bet", ready: hasBetDetails },
    { title: isHeadToHead ? "Required connections" : "Choose resolver tools", ready: hasRequiredApps },
    { title: "Set the terms", ready: hasTerms },
    { title: "Review", ready: canPublish }
  ];

  function canOpenStep(index: number): boolean {
    if (index <= step) {
      return true;
    }
    if (index === 1) {
      return hasBetDetails;
    }
    if (index === 2) {
      return hasBetDetails && hasRequiredApps;
    }
    return canPublish;
  }

  function nextStep() {
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  useEffect(() => {
    setVisibleToolLimit(90);
  }, [appSearch]);

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
          setAppIconSrcBySlug((current) => ({ ...current, ...iconMapFromApps(apps) }));
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
    let cancelled = false;
    Promise.allSettled(["exa", "browser use", "browser-use", "browser"].map((query) => api.listPipedreamApps(query)))
      .then((results) => {
        if (!cancelled) {
          const apps = results.flatMap((result) => (result.status === "fulfilled" ? result.value.apps : []));
          const icons = iconMapFromApps(apps);
          const browserUseApp = apps.find((app) => app.name.toLowerCase() === "browser use" || app.nameSlug === "browser-use" || app.nameSlug === "browser_use");
          setAppIconSrcBySlug((current) => ({
            ...current,
            ...icons,
            ...(browserUseApp?.imgSrc ? { browser_use: browserUseApp.imgSrc } : {})
          }));
        }
      })
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!publishRequestedRef.current) {
      return;
    }
    setLoading(true);
    setError("");

    try {
      const { challenge } = await api.createChallenge({
        claim,
        resolutionCriteria,
        pipedreamConnectionIds: selectedConnectionIds,
        creatorSide,
        kind: mode,
        requiredApps: isHeadToHead
          ? selectedConnections.map((connection) => ({ appSlug: connection.appSlug, appName: connection.appName, creatorConnectionId: connection.id }))
          : undefined,
        visibility,
        stakeCredits,
        expiresAt
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
      publishRequestedRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <header className="flex items-start justify-between gap-4 [&_h1]:max-w-[850px] [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
        <div>
          <h1>Launch a bet in under a minute.</h1>
          <p>Post a claim, choose your side, and lock platform credits for matching.</p>
        </div>
      </header>

      <form className="grid gap-4" onSubmit={submit}>
        <Card className="mx-auto w-full max-w-3xl">
          <CardContent className="grid gap-4 p-5 max-[560px]:p-4">
            {error && <div className={noticeErrorClass}>{error}</div>}

            {step === 0 && (
              <section className={wizardStepClass}>
                <SectionIntro step="01" title="Write the bet" description="Two fields. The claim is what people see; the criteria tell the resolver how to decide." />
                <div className="grid gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">Bet type</span>
                  <div className={segmentedClass} role="group" aria-label="Bet type">
                    <button type="button" className={mode === "open_match" ? "!bg-primary !text-primary-foreground shadow-sm" : ""} onClick={() => setMode("open_match")}>
                      <Globe2 size={16} /> Open bet
                    </button>
                    <button type="button" className={mode === "head_to_head" ? "!bg-primary !text-primary-foreground shadow-sm" : ""} onClick={() => setMode("head_to_head")}>
                      <Link2 size={16} /> Head-to-head
                    </button>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {isHeadToHead
                      ? "Challenge one specific person. You both connect the required accounts, then the resolver compares you at expiry. Share the link after publishing."
                      : "Anyone can match the opposite side of your claim."}
                  </p>
                </div>
                <Label>
                  Claim
                  <Textarea
                    className="min-h-20"
                    name="claim"
                    placeholder="Will OpenAI launch a new model by June 30?"
                    value={claim}
                    onChange={(event) => setClaim(event.target.value)}
                    required
                  />
                </Label>
                <Label>
                  Resolution criteria
                  <Textarea
                    className="min-h-20"
                    name="resolutionCriteria"
                    placeholder="Resolve YES only if OpenAI announces general availability on its official site or API docs before the expiry."
                    value={resolutionCriteria}
                    onChange={(event) => setResolutionCriteria(event.target.value)}
                    required
                  />
                </Label>
              </section>
            )}

            {step === 2 && (
              <section className={wizardStepClass}>
                <SectionIntro step="03" title="Set the terms" description="Choose the money, your side, visibility, and when the resolver runs." />
                <div className="grid gap-2">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><CircleDollarSign size={15} /> Stake</span>
                      <strong className="mt-1 block text-xl font-semibold tracking-tight">{stakeAmount || 25} credits</strong>
                    </div>
                    <Input
                      className="h-9 w-24 text-right"
                      inputMode="decimal"
                      min="5"
                      max="100"
                      name="stakeCredits"
                      type="number"
                      value={stakeCredits}
                      onChange={(event) => setStakeCredits(event.target.value)}
                      required
                    />
                  </div>
                  <Slider
                    min={5}
                    max={100}
                    step={1}
                    value={[Number.isFinite(stakeAmount) ? Math.min(100, Math.max(5, stakeAmount)) : 25]}
                    onValueChange={([value]) => setStakeCredits(String(value))}
                    aria-label="Stake credits"
                  />
                </div>

                <div className="grid gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">Your side</span>
                  <div className={segmentedClass} role="group" aria-label="Creator side">
                    <button type="button" className={creatorSide === "YES" ? "!bg-primary !text-primary-foreground shadow-sm" : ""} onClick={() => setCreatorSide("YES")}>
                      YES
                    </button>
                    <button type="button" className={creatorSide === "NO" ? "!bg-primary !text-primary-foreground shadow-sm" : ""} onClick={() => setCreatorSide("NO")}>
                      NO
                    </button>
                  </div>
                </div>

                {!isHeadToHead && (
                  <div className="grid gap-2">
                    <span className="text-sm font-semibold text-muted-foreground">Access</span>
                    <div className={segmentedClass} role="group" aria-label="Bet visibility">
                      <button type="button" className={visibility === "public" ? "!bg-primary !text-primary-foreground shadow-sm" : ""} onClick={() => setVisibility("public")}>
                        <Globe2 size={16} /> Public
                      </button>
                      <button type="button" className={visibility === "private" ? "!bg-primary !text-primary-foreground shadow-sm" : ""} onClick={() => setVisibility("private")}>
                        <Link2 size={16} /> Private
                      </button>
                    </div>
                  </div>
                )}

                <Label>
                  <span className="inline-flex items-center gap-1.5"><TimerReset size={15} /> Expiry</span>
                  <div className="grid grid-cols-[minmax(0,1fr)_122px] gap-2 max-[420px]:grid-cols-1">
                    <Input aria-label="Expiry date" name="expiryDate" type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} required />
                    <select
                      aria-label="Expiry time"
                      name="expiryTime"
                      className="h-11 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                      value={expiryTime}
                      onChange={(event) => setExpiryTime(event.target.value)}
                      required
                    >
                      {expiryTimeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </Label>
              </section>
            )}

            {step === 1 && (
              <section className="mx-auto grid w-full max-w-4xl gap-4">
              <SectionIntro
                step="02"
                title={isHeadToHead ? "Required connections" : "Choose resolver tools"}
                description={
                  isHeadToHead
                    ? "Connect the accounts this challenge compares (e.g. your GitHub). Your opponent must connect the same apps before they can accept, and the resolver reads both of you."
                    : "Pick the sources the resolver can use to check the bet. Web search and Browser Use are already included; add private apps only when the answer needs account data."
                }
              />
              <div className="grid gap-3">
                <label className="relative block w-full [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:left-3 [&_svg]:top-1/2 [&_svg]:z-10 [&_svg]:-translate-y-1/2 [&_svg]:text-muted-foreground [&_input]:pl-9">
                  <Search size={16} />
                  <Input className="h-12 w-full text-base" value={appSearch} onChange={(event) => setAppSearch(event.target.value)} placeholder="Search apps if needed" type="search" />
                </label>
                <div
                  className="grid max-h-[260px] grid-cols-[repeat(2,minmax(0,1fr))] gap-2 overflow-auto pr-1 max-[560px]:grid-cols-1"
                  onScroll={(event) => {
                    const target = event.currentTarget;
                    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 120) {
                      setVisibleToolLimit((limit) => Math.min(limit + 90, resolverTools.length));
                    }
                  }}
                >
                  {resolverToolsForView.map((tool) => {
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
                  })}
                  {!resolverTools.length && (
                    <div className="col-span-full grid gap-1 rounded-lg border border-dashed bg-card p-4 text-center text-sm text-muted-foreground [&_strong]:text-foreground">
                      <strong>No matching apps</strong>
                      <span>Try a different search.</span>
                    </div>
                  )}
                </div>
                {resolverTools.length > resolverToolsForView.length && (
                  <p className="text-xs font-medium text-muted-foreground">Showing {resolverToolsForView.length.toLocaleString()} of {resolverTools.length.toLocaleString()} apps. Search to narrow the list.</p>
                )}
                {pipedreamAppsLoading && <p className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground">Loading Pipedream app directory...</p>}
                {pipedreamAppsError && <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm leading-6 text-destructive">{pipedreamAppsError}</p>}
                {pipedreamStatus && <p className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium text-muted-foreground"><Link2 size={15} /> {pipedreamStatus}</p>}
                {connectError && <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm leading-6 text-destructive">{connectError}</p>}
                <div className="grid gap-2 border-t pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">Selected tools</span>
                    <Badge variant="outline">{selectedConnectionIds.length + 2} total</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs font-semibold text-foreground">
                      {exaIconSrc ? <span className={chipIconClass}><img src={exaIconSrc} alt="" /></span> : <Sparkles size={14} />}
                      <span>Exa web search</span>
                    </div>
                    <div className="inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs font-semibold text-foreground">
                      {browserUseIconSrc ? <span className={chipIconClass}><img src={browserUseIconSrc} alt="" /></span> : <Bot size={14} />}
                      <span>Browser Use</span>
                    </div>
                    {selectedConnections.map((connection) => {
                      const preset = resolverToolPresetsBySlug.get(connection.appSlug);
                      const iconSrc = appIconSrcBySlug[connection.appSlug];
                      return (
                        <div className="inline-flex h-7 items-center gap-2 rounded-full border bg-background px-3 text-xs font-semibold text-foreground" key={connection.id}>
                          <span className={chipIconClass}>
                            {iconSrc ? <img src={iconSrc} alt="" /> : <em>{preset?.iconFallback ?? appFallback(connection.appName)}</em>}
                          </span>
                          <span>{connection.appName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              </section>
            )}

            {step === 3 && (
              <section className={wizardStepClass}>
              <SectionIntro step="04" title="Review and publish" description="Quick check, then launch." />
              <div className="grid gap-3">
                <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <strong className="text-base font-semibold text-foreground">{claim.trim() || "Untitled bet"}</strong>
                  <span>{stakeCredits ? `${stakeCredits} credits` : "Choose a stake"} · {creatorSide} · {visibility === "public" ? "Public" : "Private"} · runs {expiryTimeOptions.find((option) => option.value === expiryTime)?.label ?? expiryTime}</span>
                  <span>{selectedConnectionIds.length + 2} resolver tools</span>
                </div>
                {!canPublish && <p className="text-sm leading-6 text-muted-foreground">Fill out the claim, resolution criteria, stake, and expiry to publish.</p>}
              </div>
              </section>
            )}

            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t pt-4 max-[520px]:grid-cols-1">
              <Button type="button" variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
                <ArrowLeft size={16} /> Back
              </Button>
              <div className="flex items-center justify-center gap-2" aria-label="Form progress">
                {steps.map((item, index) => (
                  <button
                    aria-label={`Go to step ${index + 1}`}
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full border bg-background text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45",
                      index === step && "border-primary bg-primary text-primary-foreground"
                    )}
                    disabled={!canOpenStep(index)}
                    key={item.title}
                    onClick={() => setStep(index)}
                    type="button"
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
              {step < steps.length - 1 ? (
                <Button
                  type="button"
                  onClick={nextStep}
                  disabled={(step === 0 && !hasBetDetails) || (step === 1 && !hasRequiredApps) || (step === 2 && !hasTerms)}
                >
                  {step === 2 ? "Review" : "Next"} <ArrowRight size={16} />
                </Button>
              ) : (
                <Button type="submit" disabled={loading || !canPublish} onClick={() => { publishRequestedRef.current = true; }}>
                  <CheckCircle2 size={18} /> {loading ? "Publishing..." : "Publish bet"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function SectionIntro(props: { step: string; title: string; description: string }) {
  return (
    <div className="grid content-start gap-1">
      <span className="text-xs font-semibold uppercase text-muted-foreground">{props.step}</span>
      <h2 className="text-base font-semibold tracking-tight">{props.title}</h2>
      <p className="text-xs leading-5 text-muted-foreground">{props.description}</p>
    </div>
  );
}
