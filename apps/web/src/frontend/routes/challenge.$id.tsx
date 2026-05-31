import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, Copy, ExternalLink, Trash2, UserRound, Zap } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch, ResolutionRun } from "@moltbooky/core/domain/types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api, type ChallengeResolverConnection } from "../lib/api";
import { credits, shortDate } from "../lib/format";
import { setSeoMeta } from "../lib/seo";
import { cn } from "../lib/utils";
import { authChangeEvent, challengeRefreshEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "challenge/$id",
  component: ChallengeDetail
});

function ChallengeDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [matches, setMatches] = useState<ChallengeMatch[]>([]);
  const [resolutionRuns, setResolutionRuns] = useState<ResolutionRun[]>([]);
  const [available, setAvailable] = useState(0);
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [resolverConnections, setResolverConnections] = useState<ChallengeResolverConnection[]>([]);
  const [appIconSrcBySlug, setAppIconSrcBySlug] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const [matchCredits, setMatchCredits] = useState("5");
  const [matching, setMatching] = useState(false);
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    const data = await api.getChallenge(id);
    setChallenge(data.challenge);
    setMatches(data.matches);
    setResolutionRuns(data.resolutionRuns);
    setAvailable(data.availableToMatchCents);
    setResolverConnections(data.resolverConnections ?? []);
  }

  useEffect(() => {
    refresh().catch((err: Error) => setMessage(err.message));
  }, [id]);

  useEffect(() => {
    function refreshChallenge() {
      refresh().catch((err: Error) => setMessage(err.message));
    }

    window.addEventListener(challengeRefreshEvent, refreshChallenge);
    return () => window.removeEventListener(challengeRefreshEvent, refreshChallenge);
  }, [id]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!challenge) {
      return;
    }

    const expiresAt = new Date(challenge.expiresAt).getTime();
    const shouldPoll = challenge.status === "resolving" || (challenge.status === "open" && expiresAt <= now);
    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      refresh().catch((err: Error) => setMessage(err.message));
    }, 8000);
    return () => window.clearInterval(interval);
  }, [challenge?.expiresAt, challenge?.status, id, challenge ? new Date(challenge.expiresAt).getTime() <= now : false]);

  useEffect(() => {
    if (!challenge) {
      return;
    }

    setSeoMeta({
      title: `${challenge.claim.slice(0, 82)} | Moltbooky`,
      description: `${credits(challenge.stakeCents)} ${challenge.creatorSide} at 1:1 odds. ${credits(available)} still available to match before ${shortDate(challenge.expiresAt)}.`,
      path: `/challenge/${challenge.id}`,
      image: `${window.location.origin}/share/challenge/${encodeURIComponent(challenge.id)}`
    });
  }, [available, challenge]);

  useEffect(() => {
    let active = true;

    async function refreshAuth() {
      const currentUser = await getCurrentUser();
      if (active) {
        setUser(currentUser);
      }
    }

    void refreshAuth();
    window.addEventListener(authChangeEvent, refreshAuth);
    window.addEventListener("focus", refreshAuth);

    return () => {
      active = false;
      window.removeEventListener(authChangeEvent, refreshAuth);
      window.removeEventListener("focus", refreshAuth);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const uniqueNames = Array.from(new Set(["exa", ...resolverConnections.map((connection) => connection.appName).filter(Boolean)]));
    Promise.allSettled([api.listPipedreamApps(), ...uniqueNames.map((name) => api.listPipedreamApps(name))]).then((results) => {
      if (!active) {
        return;
      }
      const icons = Object.fromEntries(
        results
          .flatMap((result) => (result.status === "fulfilled" ? result.value.apps : []))
          .filter((app) => app.imgSrc)
          .map((app) => [app.nameSlug, app.imgSrc!])
      );
      setAppIconSrcBySlug((current) => ({ ...current, ...icons }));
    });
    return () => {
      active = false;
    };
  }, [resolverConnections]);

  if (!challenge) {
    return <ChallengeDetailSkeleton />;
  }

  const canDelete = user?.id === challenge.creatorId && challenge.matchedCents === 0 && matches.length === 0;
  const isCreator = user?.id === challenge.creatorId;
  const takerSide = oppositeSide(challenge.creatorSide);
  const creatorName = challenge.creatorName?.trim() || challenge.creatorId;
  const agentRunLabel = formatAgentRun(challenge.expiresAt, now);
  const latestRun = resolutionRuns[0] ?? null;

  async function deleteChallenge() {
    if (!challenge || !window.confirm("Delete this unmatched bet and return the locked credits?")) {
      return;
    }
    setDeleting(true);
    setMessage("");
    try {
      await api.deleteChallenge(challenge.id);
      await navigate({ to: "/my-bets" });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bet could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function matchBet() {
    if (!challenge) {
      return;
    }
    setMatching(true);
    setMessage("");
    try {
      await api.matchChallenge(challenge.id, matchCredits);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bet could not be matched.");
    } finally {
      setMatching(false);
    }
  }

  return (
    <div className="mx-auto grid h-[calc(100vh-112px)] max-w-7xl gap-3 overflow-hidden">
      {message && <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">{message}</div>}

      <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3 max-[980px]:grid-cols-1">
        <div className="grid min-h-0">
          <AgentChatPanel
            challenge={challenge}
            latestRun={latestRun}
            resolverConnections={resolverConnections}
            iconSrcBySlug={appIconSrcBySlug}
            agentRunLabel={agentRunLabel}
          />
        </div>

        <aside className="grid max-h-full content-start gap-2 overflow-y-auto pr-1">
          <Card>
            <CardHeader className="p-4">
              <CardTitle>Bet details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 px-4 pb-4 pt-0 text-sm">
              <DetailRow label="Amount" value={credits(challenge.stakeCents)} detail="Even odds" />
              <DetailRow label="Creator side" value={challenge.creatorSide} detail={`The other side is ${takerSide}`} />
              <DetailRow label="Creator" value={creatorName} detail="Started this bet" icon={<UserRound size={16} />} />
              <DetailRow label="Matched" value={credits(challenge.matchedCents)} detail={`${credits(available)} still open`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle>{isCreator ? "Share this bet" : "Take the other side"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 pb-4 pt-0">
              {isCreator ? (
                <>
                  <p className="text-sm leading-6 text-muted-foreground">You cannot match your own bet. Send the link to someone who wants the opposite side.</p>
                  <Button variant="outline" type="button" onClick={() => navigator.clipboard.writeText(window.location.href)}>
                    <Copy size={18} /> Copy link
                  </Button>
                  {canDelete && (
                    <Button type="button" variant="destructive" onClick={deleteChallenge} disabled={deleting}>
                      <Trash2 size={18} /> {deleting ? "Deleting..." : "Delete bet"}
                    </Button>
                  )}
                </>
              ) : user ? (
                <>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-muted-foreground">Credits</span>
                    <Input
                      inputMode="decimal"
                      min="0.01"
                      max={String(available / 100)}
                      step="0.01"
                      value={matchCredits}
                      onChange={(event) => setMatchCredits(event.target.value)}
                    />
                  </label>
                  <Button type="button" onClick={matchBet} disabled={matching || available <= 0}>
                    {matching ? "Matching..." : available > 0 ? "Match bet" : "Fully matched"}
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild>
                    <Link to="/login">Sign up to match</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/login">Log in</Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function AgentChatPanel(props: {
  challenge: Challenge;
  latestRun: ResolutionRun | null;
  resolverConnections: ChallengeResolverConnection[];
  iconSrcBySlug: Record<string, string>;
  agentRunLabel: { primary: string; secondary: string };
}) {
  const isWaiting = props.challenge.status === "open" && !props.latestRun;
  const isRunning = props.challenge.status === "resolving";
  const hasNoRun = !isWaiting && !isRunning && !props.latestRun;

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <CardHeader className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Resolver chat</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Tool usage, evidence, and the resolution summary appear here.</p>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground"><Bot size={16} /></span>
        </div>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 pb-4 pt-0">
        <PromptBubble challenge={props.challenge} connections={props.resolverConnections} iconSrcBySlug={props.iconSrcBySlug} />

        {isWaiting && (
          <ChatBubble role="agent" title="Resolver scheduled">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="text-2xl font-semibold tracking-tight">{props.agentRunLabel.primary}</strong>
              <span className="text-sm font-medium text-muted-foreground">{props.agentRunLabel.secondary}</span>
            </div>
          </ChatBubble>
        )}

        {isRunning && (
          <ChatBubble role="agent" title="Resolver running">
            <div className="grid gap-2">
              <strong className="text-xl font-semibold">Checking evidence now</strong>
              <p className="text-sm leading-6 text-muted-foreground">Tool calls and the final rationale will appear here when the resolver finishes.</p>
              <div className="flex gap-1 pt-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
              </div>
            </div>
          </ChatBubble>
        )}

        {hasNoRun && (
          <ChatBubble role="agent" title="Resolver status">
            <p className="text-sm leading-6 text-muted-foreground">
              This bet is {props.challenge.status.replaceAll("_", " ")}. No resolver run has been recorded yet.
            </p>
          </ChatBubble>
        )}

        {props.latestRun && (
          <>
            <ToolCallBubble name="Exa web search" detail={props.latestRun.exaQuery} />
            {props.resolverConnections.map((connection) => (
              <ToolCallBubble key={connection.id} name={connection.appName} detail="Private account evidence source available to the resolver." />
            ))}
            <ChatBubble role="agent" title="Resolver result">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Outcome {props.latestRun.proposedOutcome}</Badge>
                  <Badge variant="outline">{Math.round(props.latestRun.confidence * 100)}% confidence</Badge>
                </div>
                <p className="text-sm leading-6 text-foreground">{props.latestRun.aiRationale}</p>
                {props.latestRun.sourceUrls.length > 0 && (
                  <div className="grid gap-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">Sources</span>
                    {props.latestRun.sourceUrls.map((url) => (
                      <a className="inline-flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium text-foreground no-underline hover:bg-muted" href={url} key={url} rel="noreferrer" target="_blank">
                        <ExternalLink size={14} />
                        <span className="truncate">{url}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </ChatBubble>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PromptBubble(props: { challenge: Challenge; connections: ChallengeResolverConnection[]; iconSrcBySlug: Record<string, string> }) {
  return (
    <div className="sticky top-0 z-10 grid gap-3 rounded-lg border bg-background p-3 shadow-sm">
      <span className="text-xs font-semibold uppercase text-muted-foreground">Prompt</span>
      <h1 className="text-2xl font-bold leading-tight tracking-tight max-[720px]:text-xl">{props.challenge.claim}</h1>
      <div className="rounded-md bg-muted/50 p-3 text-sm leading-5 text-muted-foreground">
        <strong className="mb-1 block text-xs uppercase text-muted-foreground">Resolution criteria</strong>
        {props.challenge.resolutionCriteria}
      </div>
      <div className="mt-1 border-t pt-3">
        <span className="mb-2 block text-sm font-semibold text-foreground">Selected tools</span>
        <div className="flex flex-wrap gap-2">
          <ToolChip label="Exa web search" iconSrc={props.iconSrcBySlug.exa} fallback="EX" />
          {props.connections.map((connection) => (
            <ToolChip key={connection.id} label={connection.appName} iconSrc={props.iconSrcBySlug[connection.appSlug]} fallback={connection.appName.slice(0, 2).toUpperCase()} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolChip(props: { fallback: string; iconSrc?: string; label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full border bg-background px-2.5 text-xs font-semibold text-foreground">
      <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-[9px] font-black text-muted-foreground [&_img]:h-4 [&_img]:w-4 [&_img]:object-contain">
        {props.iconSrc ? <img src={props.iconSrc} alt="" /> : props.fallback}
      </span>
      <span>{props.label}</span>
    </span>
  );
}

function ChatBubble(props: { children: React.ReactNode; role: "agent" | "user"; title: string }) {
  const isAgent = props.role === "agent";
  return (
    <div className={cn("flex items-start gap-2", !isAgent && "justify-end")}>
      {isAgent && <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"><Bot size={14} /></span>}
      <div className={cn("grid max-w-[680px] gap-2 rounded-lg border p-3", isAgent ? "bg-card" : "bg-primary text-primary-foreground")}>
        <span className={cn("text-xs font-semibold uppercase", isAgent ? "text-muted-foreground" : "text-primary-foreground/75")}>{props.title}</span>
        <div className={cn("text-sm leading-6", !isAgent && "font-medium")}>{props.children}</div>
      </div>
    </div>
  );
}

function ToolCallBubble(props: { name: string; detail: string }) {
  return (
    <div className="ml-9 grid gap-2 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-background text-muted-foreground"><Zap size={14} /></span>
        <span className="text-xs font-semibold uppercase text-muted-foreground">Tool call</span>
      </div>
      <strong className="text-sm font-semibold text-foreground">{props.name}</strong>
      <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{props.detail}</p>
    </div>
  );
}

function DetailRow(props: { detail?: string; icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0">
      <div className="grid gap-1">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</span>
        <strong className="text-sm font-semibold text-foreground">{props.value}</strong>
        {props.detail && <small className="text-xs font-medium leading-5 text-muted-foreground">{props.detail}</small>}
      </div>
      {props.icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">{props.icon}</span>}
    </div>
  );
}

function formatAgentRun(expiresAt: string, now: number): { primary: string; secondary: string } {
  const runAt = new Date(expiresAt);
  const msUntilRun = runAt.getTime() - now;
  if (msUntilRun <= 0) {
    return { primary: shortDate(expiresAt), secondary: "Runs as soon as the resolver picks it up" };
  }
  return { primary: formatCountdown(msUntilRun), secondary: `Runs ${shortDate(expiresAt)}` };
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function ChallengeDetailSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="grid gap-5 rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-10 w-full max-w-[760px]" />
        <Skeleton className="h-5 w-full max-w-[640px]" />
      </header>
      <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-[880px]:grid-cols-1">
        <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
          {Array.from({ length: 5 }).map((_, index) => (
          <div className="rounded-lg border bg-card p-4" key={index}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-44 w-full" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
