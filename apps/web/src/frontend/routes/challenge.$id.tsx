import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrainCircuit, Clock3, Copy, ExternalLink, Flame, RefreshCw, SearchCheck, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch, ResolutionRun } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { matchProgress, credits, shortDate } from "../lib/format";
import { setSeoMeta } from "../lib/seo";
import { cn } from "../lib/utils";
import { authChangeEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

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
  }

  useEffect(() => {
    refresh().catch((err: Error) => setMessage(err.message));
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
    const isExpired = expiresAt <= now;
    const shouldPoll = challenge.status === "resolving" || (challenge.status === "open" && isExpired);
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

  if (!challenge) {
    return <ChallengeDetailSkeleton />;
  }

  const canDelete = user?.id === challenge.creatorId && challenge.matchedCents === 0 && matches.length === 0;
  const takerSide = oppositeSide(challenge.creatorSide);
  const latestRun = resolutionRuns[0] ?? null;
  const expiresAt = new Date(challenge.expiresAt).getTime();
  const resolutionStartsInMs = Math.max(0, expiresAt - now);
  const agentState = getAgentState(challenge, latestRun, now);
  const matcherNames = [...new Set(matches.map((match) => match.matcherName || match.matcherId))];

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

  async function matchMarket() {
    if (!challenge) {
      return;
    }

    setMatching(true);
    setMessage("");
    try {
      await api.matchChallenge(challenge.id, matchCredits);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Market could not be matched.");
    } finally {
      setMatching(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="flex items-start justify-between gap-4 border-b pb-5 [&_h1]:max-w-[850px] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-2xl [&_p]:mt-2 [&_p]:max-w-3xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <StatusPill status={challenge.status} />
            <Badge variant="outline">Expires {shortDate(challenge.expiresAt)}</Badge>
            <Badge variant="outline">{challenge.visibility === "private" ? "Private link" : "Public"}</Badge>
            <Badge variant="outline">1:1 odds</Badge>
          </div>
          <h1>{challenge.claim}</h1>
          <p>{challenge.resolutionCriteria}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="icon" onClick={refresh} aria-label="Refresh challenge">
            <RefreshCw size={18} />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(window.location.href)} aria-label="Copy link">
            <Copy size={18} />
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-4 gap-3 max-[960px]:grid-cols-2 max-[560px]:grid-cols-1 [&>div]:rounded-lg [&>div]:border [&>div]:bg-card [&>div]:p-4 [&>div]:text-card-foreground [&_span]:block [&_span]:text-sm [&_span]:leading-6 [&_span]:text-muted-foreground [&_strong]:mt-1 [&_strong]:block [&_strong]:truncate [&_strong]:text-xl [&_strong]:font-semibold [&_strong]:tracking-tight [&_strong]:text-foreground">
        <div>
          <span>Creator side</span>
          <strong>{challenge.creatorSide}</strong>
        </div>
        <div>
          <span>Matched</span>
          <strong>{credits(challenge.matchedCents)}</strong>
        </div>
        <div>
          <span>Open</span>
          <strong>{credits(available)}</strong>
        </div>
        <div>
          <span>Matched by</span>
          <strong>{matcherNames.length > 0 ? matcherNames.join(", ") : "No one yet"}</strong>
        </div>
      </section>

      {message && <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">{message}</div>}

      <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-[920px]:grid-cols-1">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2"><Flame size={18} /> Market state</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-stretch gap-3 max-[680px]:grid-cols-1">
              <div className="grid gap-2 rounded-lg border border-border bg-card p-5 text-foreground">
                <span className="text-sm font-bold text-slate-500">Creator</span>
                <strong className="text-4xl font-semibold leading-none tracking-tight">{challenge.creatorSide}</strong>
                <small className="text-sm font-bold text-slate-500">{credits(challenge.stakeCents)} posted</small>
              </div>
              <div className="grid place-items-center rounded-md bg-muted text-xs font-semibold uppercase text-muted-foreground max-[680px]:mx-auto max-[680px]:h-10 max-[680px]:w-10">vs</div>
              <div className="grid gap-2 rounded-lg border border-border bg-card p-5 text-foreground">
                <span className="text-sm font-bold text-slate-500">Open side</span>
                <strong className="text-4xl font-semibold leading-none tracking-tight">{takerSide}</strong>
                <small className="text-sm font-bold text-slate-500">{credits(available)} available</small>
              </div>
            </div>
            <div className="mt-5 grid gap-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-muted-foreground">Matched</span>
                <strong className="text-lg font-semibold">{credits(challenge.matchedCents)}</strong>
              </div>
              <div className="mb-5 h-3 overflow-hidden rounded-full bg-secondary">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${matchProgress(challenge)}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1 [&>div]:rounded-lg [&>div]:border [&>div]:bg-card [&>div]:p-4 [&>div]:text-card-foreground [&_span]:block [&_span]:text-sm [&_span]:leading-6 [&_span]:text-muted-foreground [&_strong]:mt-1 [&_strong]:block [&_strong]:text-2xl [&_strong]:font-semibold [&_strong]:tracking-tight [&_strong]:text-foreground">
              <div>
                <span>Available</span>
                <strong>{credits(available)}</strong>
              </div>
              <div>
                <span>Total stake</span>
                <strong>{credits(challenge.stakeCents)}</strong>
              </div>
              <div>
                <span>Odds</span>
                <strong>1:1</strong>
              </div>
            </div>
            <p className="mt-4 inline-flex items-center gap-2 text-sm leading-6 text-muted-foreground"><ShieldCheck size={15} /> Only matched credits are at risk. Unmatched creator credits can be released while the market remains open.</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle>Trade ticket</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-5 text-foreground">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Take the other side</span>
              <strong className="text-4xl font-semibold leading-none tracking-tight">{takerSide}</strong>
              <small className="text-sm font-semibold text-muted-foreground">Win {credits(Number(matchCredits || 0) * 100)} at even odds</small>
            </div>
            <p className="mt-4 inline-flex items-center gap-2 text-sm leading-6 text-muted-foreground">
              {user ? "Match any open amount at 1:1 odds, or spin up your own challenge." : "Log in or sign up to match this market, release stake, or create your own challenge."}
            </p>
            {user ? (
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
                <div className="grid grid-cols-2 gap-2 max-[420px]:grid-cols-1">
                  <Button type="button" onClick={matchMarket} disabled={matching || available <= 0}>
                    {matching ? "Matching..." : "Match market"}
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/challenge/new">Create market</Link>
                  </Button>
                </div>
                {canDelete && (
                  <Button type="button" variant="destructive" onClick={deleteChallenge} disabled={deleting}>
                    <Trash2 size={18} /> {deleting ? "Deleting..." : "Delete bet"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button asChild>
                  <Link to="/login">Sign up to trade</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/login">Log in</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 rounded-lg border border-slate-200 bg-card p-5 text-card-foreground shadow-sm [&_h2]:inline-flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight">
        <div className="flex items-start justify-between gap-4">
          <h2><BrainCircuit size={18} /> Resolution agent</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {challenge.pipedreamConnectionIds.length > 0 && <Badge variant="outline">{challenge.pipedreamConnectionIds.length} connected app{challenge.pipedreamConnectionIds.length === 1 ? "" : "s"}</Badge>}
            <Badge variant="outline">{agentState.label}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4 max-[760px]:grid-cols-1">
          <div className="grid content-center gap-2 rounded-lg border bg-slate-50 p-5 [&_svg]:text-primary">
            <Clock3 size={18} />
            <span className="text-xs font-black uppercase text-muted-foreground">{agentState.caption}</span>
            <strong className="text-3xl font-black tracking-normal text-foreground">{latestRun ? shortDate(latestRun.createdAt) : formatCountdown(resolutionStartsInMs)}</strong>
          </div>
          <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
            <div className={cn("grid min-h-[118px] content-between rounded-lg border bg-card p-4", agentState.phase === "waiting" && "border-primary/40 bg-primary/5")}>
              <span className={cn("grid h-8 w-8 place-items-center rounded-full bg-muted text-sm font-black text-muted-foreground", agentState.phase === "waiting" && "bg-primary text-primary-foreground")}>1</span>
              <p className="text-sm leading-6 text-muted-foreground">Wait until the market expires.</p>
            </div>
            <div className={cn("grid min-h-[118px] content-between rounded-lg border bg-card p-4", agentState.phase === "running" && "border-primary/40 bg-primary/5")}>
              <span className={cn("grid h-8 w-8 place-items-center rounded-full bg-muted text-sm font-black text-muted-foreground", agentState.phase === "running" && "bg-primary text-primary-foreground")}>2</span>
              <p className="text-sm leading-6 text-muted-foreground">{challenge.pipedreamConnectionIds.length > 0 ? "Search and call the attached Pipedream connections for evidence." : "Search for evidence against the resolution criteria."}</p>
            </div>
            <div className={cn("grid min-h-[118px] content-between rounded-lg border bg-card p-4", agentState.phase === "finished" && "border-primary/40 bg-primary/5")}>
              <span className={cn("grid h-8 w-8 place-items-center rounded-full bg-muted text-sm font-black text-muted-foreground", agentState.phase === "finished" && "bg-primary text-primary-foreground")}>3</span>
              <p className="text-sm leading-6 text-muted-foreground">Publish a provisional decision trail for everyone.</p>
            </div>
          </div>
        </div>

        {latestRun ? (
          <div className="grid gap-4 rounded-lg border bg-slate-50 p-4">
            <div className="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1 [&>div]:rounded-lg [&>div]:border [&>div]:bg-card [&>div]:p-4 [&_span]:text-xs [&_span]:font-black [&_span]:uppercase [&_span]:text-muted-foreground [&_strong]:mt-2 [&_strong]:block [&_strong]:text-2xl [&_strong]:font-black [&_strong]:tracking-normal [&_strong]:text-foreground">
              <div>
                <span>Decision</span>
                <strong className={cn(latestRun.proposedOutcome === "YES" && "text-emerald-700", latestRun.proposedOutcome === "NO" && "text-red-700", latestRun.proposedOutcome === "UNRESOLVED" && "text-slate-700")}>{latestRun.proposedOutcome}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{Math.round(latestRun.confidence * 100)}%</strong>
              </div>
              <div>
                <span>Ran</span>
                <strong>{shortDate(latestRun.createdAt)}</strong>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-2 inline-flex items-center gap-2 text-base font-semibold"><SearchCheck size={17} /> Public rationale</h3>
              <p className="text-sm leading-6 text-muted-foreground">{latestRun.aiRationale}</p>
            </div>
            <div className="grid gap-2">
              <span className="text-xs font-black uppercase text-muted-foreground">Evidence query</span>
              <code className="m-0 block overflow-auto whitespace-pre-wrap break-words rounded-md bg-card p-3 text-sm text-foreground">{latestRun.exaQuery}</code>
            </div>
            <div className="grid gap-2">
              <span className="text-xs font-black uppercase text-muted-foreground">Sources</span>
              {latestRun.sourceUrls.length > 0 ? (
                <div className="grid gap-2">
                  {latestRun.sourceUrls.map((url) => (
                    <a className="inline-flex items-center gap-2 overflow-hidden rounded-md border bg-card px-3 py-2 text-sm font-medium text-foreground no-underline hover:bg-muted" key={url} href={url} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} /> {url}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-4 inline-flex items-center gap-2 text-sm leading-6 text-muted-foreground">No external sources were recorded for this run.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-4 inline-flex items-center gap-2 text-sm leading-6 text-muted-foreground">
            The agent run becomes visible here after expiry. Viewers will see the search query, sources, confidence, provisional decision, and public rationale.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-card p-5 text-card-foreground shadow-sm [&_h2]:inline-flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight">
        <div className="flex items-start justify-between gap-4">
          <h2><Sparkles size={18} /> Share market</h2>
          <Button variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(window.location.href)} aria-label="Copy link">
            <Copy size={18} />
          </Button>
        </div>
        <div className="mt-4 grid gap-2 rounded-lg border bg-muted p-5 text-foreground [&>*]:relative [&_div]:grid [&_div]:gap-2 [&_span]:text-xs [&_span]:font-semibold [&_span]:uppercase [&_span]:text-muted-foreground [&_strong]:text-xl [&_strong]:font-semibold [&_strong]:text-foreground [&_p]:max-w-4xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground [&_small]:text-sm [&_small]:font-medium [&_small]:text-muted-foreground">
          <div>
            <span>{challenge.visibility === "private" ? "Private Moltbooky challenge" : "Moltbooky challenge"}</span>
            <strong>I’m taking {challenge.creatorSide} for {credits(challenge.stakeCents)}</strong>
            <p>{challenge.claim}</p>
          </div>
          <small>{credits(available)} still available to match on {takerSide}.</small>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5 text-card-foreground [&_h2]:inline-flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight">
        <h2>Matches</h2>
        <div className="grid gap-3 [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-4 [&>div]:border-b [&>div]:border-border [&>div]:py-3 last:[&>div]:border-b-0 max-[560px]:[&>div]:grid [&_span]:text-sm [&_span]:font-medium [&_span]:text-muted-foreground [&_strong]:text-sm [&_strong]:font-medium">
          {matches.map((matchItem) => (
            <div key={matchItem.id}>
              <span>{matchItem.matcherName || matchItem.matcherId}</span>
              <strong>{credits(matchItem.amountCents)} {matchItem.side}</strong>
            </div>
          ))}
          {matches.length === 0 && <p className="mt-4 inline-flex items-center gap-2 text-sm leading-6 text-muted-foreground">No one has taken the other side yet.</p>}
        </div>
      </section>
    </div>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) {
    return "Due now";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function getAgentState(challenge: Challenge, latestRun: ResolutionRun | null, now: number): { label: string; caption: string; phase: "waiting" | "running" | "finished" } {
  if (latestRun || challenge.status === "provisional_resolved" || challenge.status === "final_resolved") {
    return { label: "Decision published", caption: "Latest run", phase: "finished" };
  }
  if (challenge.status === "resolving" || new Date(challenge.expiresAt).getTime() <= now) {
    return { label: "Agent running", caption: "Resolution starts", phase: "running" };
  }
  return { label: "Countdown active", caption: "Runs in", phase: "waiting" };
}

function ChallengeDetailSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="grid w-full gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-9 w-full max-w-[760px]" />
          <Skeleton className="h-5 w-full max-w-[640px]" />
        </div>
        <Skeleton className="h-10 w-10 shrink-0" />
      </header>

      <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-[920px]:grid-cols-1">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="mb-5 h-3 w-full rounded-full" />
            <div className="grid grid-cols-4 gap-3 max-[920px]:grid-cols-2 max-[560px]:grid-cols-1 [&>div]:rounded-lg [&>div]:border [&>div]:bg-card [&>div]:p-4 [&>div]:text-card-foreground">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-3 h-8 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="mt-4 h-5 w-full max-w-[560px]" />
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <Skeleton className="h-6 w-28" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-1 rounded-md border border-border bg-muted p-4">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-9 w-16" />
            </div>
            <Skeleton className="mt-4 h-5 w-full" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-2 h-10 w-full" />
          </CardContent>
        </Card>
      </section>

      <section className="rounded-lg border bg-card p-5 text-card-foreground">
        <div className="flex items-start justify-between gap-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-10 w-10" />
        </div>
        <div className="mt-4 grid gap-2 rounded-lg border bg-muted p-5 text-foreground">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-full max-w-[640px]" />
          <Skeleton className="h-4 w-40" />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5 text-card-foreground">
        <Skeleton className="h-6 w-24" />
        <div className="mt-4 grid gap-3 [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-4 [&>div]:border-b [&>div]:border-border [&>div]:py-3 last:[&>div]:border-b-0 max-[560px]:[&>div]:grid">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index}>
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
