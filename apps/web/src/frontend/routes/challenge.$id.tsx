import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarClock, CircleDollarSign, Copy, PlugZap, RefreshCw, Trash2, UserRound } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch, ResolutionTool } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { credits, shortDate } from "../lib/format";
import { setSeoMeta } from "../lib/seo";
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

  if (!challenge) {
    return <ChallengeDetailSkeleton />;
  }

  const canDelete = user?.id === challenge.creatorId && challenge.matchedCents === 0 && matches.length === 0;
  const isCreator = user?.id === challenge.creatorId;
  const takerSide = oppositeSide(challenge.creatorSide);
  const creatorName = challenge.creatorName?.trim() || challenge.creatorId;
  const resolverConnections = resolverConnectionNames(challenge.resolutionTool);
  const agentRunLabel = formatAgentRun(challenge.expiresAt, now);

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
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="grid overflow-hidden rounded-lg border bg-card text-card-foreground">
        <div className="grid gap-6 p-6 max-[640px]:p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusPill status={challenge.status} />
              <Badge variant="outline">{challenge.visibility === "private" ? "Private" : "Public"}</Badge>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="icon" onClick={refresh} aria-label="Refresh bet">
                <RefreshCw size={18} />
              </Button>
              <Button variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(window.location.href)} aria-label="Copy link">
                <Copy size={18} />
              </Button>
            </div>
          </div>

          <div className="grid max-w-4xl gap-3">
            <span className="text-xs font-semibold uppercase text-muted-foreground">The bet</span>
            <h1 className="text-4xl font-bold leading-tight tracking-tight max-[720px]:text-3xl">{challenge.claim}</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{challenge.resolutionCriteria}</p>
          </div>
        </div>
      </header>

      {message && <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">{message}</div>}

      <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-[880px]:grid-cols-1">
        <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
          <FactTile icon={<CircleDollarSign size={18} />} label="Amount" value={credits(challenge.stakeCents)} detail="Even odds" />
          <FactTile label="Creator side" value={challenge.creatorSide} detail={`The other side is ${takerSide}`} />
          <FactTile icon={<UserRound size={18} />} label="Creator" value={creatorName} detail="Started this bet" />
          <FactTile icon={<PlugZap size={18} />} label="Resolver connections" value={resolverConnections.length ? resolverConnections.join(", ") : "None"} detail={resolverConnections.length ? "Available to the agent" : "Exa search only"} />
          <div className="col-span-2 max-[640px]:col-span-1">
            <FactTile icon={<CalendarClock size={18} />} label="Resolver run" value={agentRunLabel.primary} detail={agentRunLabel.secondary} />
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{isCreator ? "Share this bet" : "Take the other side"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
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
      </section>
    </div>
  );
}

function FactTile(props: { icon?: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="grid min-h-[132px] content-between gap-4 rounded-lg border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</span>
        {props.icon && <span className="grid h-8 w-8 place-items-center rounded-md bg-muted text-muted-foreground">{props.icon}</span>}
      </div>
      <div className="grid gap-1">
        <strong className="break-words text-2xl font-semibold leading-tight tracking-tight">{props.value}</strong>
        <small className="text-sm font-medium leading-5 text-muted-foreground">{props.detail}</small>
      </div>
    </div>
  );
}

function resolverConnectionNames(resolutionTool: Challenge["resolutionTool"]): string[] {
  const tools = Array.isArray(resolutionTool) ? resolutionTool : resolutionTool ? [resolutionTool] : [];
  const names = tools
    .filter((tool): tool is ResolutionTool => tool.type === "pipedream_action")
    .map((tool) => tool.appName?.trim() || tool.appSlug)
    .filter(Boolean);
  return [...new Set(names)];
}

function formatAgentRun(expiresAt: string, now: number): { primary: string; secondary: string } {
  const runAt = new Date(expiresAt);
  const msUntilRun = runAt.getTime() - now;
  if (msUntilRun <= 0) {
    return { primary: shortDate(expiresAt), secondary: "Runs as soon as the resolver picks it up" };
  }
  return { primary: shortDate(expiresAt), secondary: "Runs at expiry" };
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
