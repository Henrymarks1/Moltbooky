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
  const creatorSideClass = challenge.creatorSide.toLowerCase();
  const takerSide = oppositeSide(challenge.creatorSide);
  const takerSideClass = takerSide.toLowerCase();
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
    <div className="page challenge-page">
      <header className="page-header challenge-detail-header">
        <div>
          <div className="row-meta">
            <StatusPill status={challenge.status} />
            <Badge variant="outline">Expires {shortDate(challenge.expiresAt)}</Badge>
            <Badge variant="outline">{challenge.visibility === "private" ? "Private link" : "Public"}</Badge>
            <Badge variant="outline">1:1 odds</Badge>
          </div>
          <h1>{challenge.claim}</h1>
          <p>{challenge.resolutionCriteria}</p>
        </div>
        <div className="hero-actions">
          <Button variant="secondary" size="icon" onClick={refresh} aria-label="Refresh challenge">
            <RefreshCw size={18} />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(window.location.href)} aria-label="Copy link">
            <Copy size={18} />
          </Button>
        </div>
      </header>

      <section className="stats-grid challenge-summary">
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

      {message && <div className="notice">{message}</div>}

      <section className="detail-grid">
        <Card className="market-panel">
          <CardHeader>
            <CardTitle className="challenge-card-title"><Flame size={18} /> Market state</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="side-matchup">
              <div className={`side-tile ${creatorSideClass}`}>
                <span>Creator</span>
                <strong>{challenge.creatorSide}</strong>
                <small>{credits(challenge.stakeCents)} posted</small>
              </div>
              <div className="versus-mark">vs</div>
              <div className={`side-tile ${takerSideClass}`}>
                <span>Open side</span>
                <strong>{takerSide}</strong>
                <small>{credits(available)} available</small>
              </div>
            </div>
            <div className="market-progress">
              <div>
                <span>Matched</span>
                <strong>{credits(challenge.matchedCents)}</strong>
              </div>
              <div className="meter">
                <span style={{ width: `${matchProgress(challenge)}%` }} />
              </div>
            </div>
            <div className="stats-grid challenge-stats">
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
            <p className="fine-print"><ShieldCheck size={15} /> Only matched credits are at risk. Unmatched creator credits can be released while the market remains open.</p>
          </CardContent>
        </Card>

        <Card className="trade-ticket">
          <CardHeader>
            <CardTitle>Trade ticket</CardTitle>
          </CardHeader>
          <CardContent className="trade-ticket-content">
            <div className={`trade-side ${takerSideClass}`}>
              <span>Take the other side</span>
              <strong>{takerSide}</strong>
              <small>Win {credits(Number(matchCredits || 0) * 100)} at even odds</small>
            </div>
            <p className="fine-print">
              {user ? "Match any open amount at 1:1 odds, or spin up your own challenge." : "Log in or sign up to match this market, release stake, or create your own challenge."}
            </p>
            {user ? (
              <>
                <label className="trade-amount">
                  <span>Credits</span>
                  <Input
                    inputMode="decimal"
                    min="0.01"
                    max={String(available / 100)}
                    step="0.01"
                    value={matchCredits}
                    onChange={(event) => setMatchCredits(event.target.value)}
                  />
                </label>
                <div className="trade-ticket-actions">
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

      <section className="panel agent-panel">
        <div className="section-title">
          <h2><BrainCircuit size={18} /> Resolution agent</h2>
          <div className="row-meta">
            {challenge.resolutionTool?.type === "pipedream_action" && <Badge variant="outline">{challenge.resolutionTool.appName || challenge.resolutionTool.appSlug}</Badge>}
            <Badge variant="outline">{agentState.label}</Badge>
          </div>
        </div>
        <div className="agent-status-grid">
          <div className="agent-countdown">
            <Clock3 size={18} />
            <span>{agentState.caption}</span>
            <strong>{latestRun ? shortDate(latestRun.createdAt) : formatCountdown(resolutionStartsInMs)}</strong>
          </div>
          <div className="agent-step-list">
            <div className={agentState.phase === "waiting" ? "active" : ""}>
              <span>1</span>
              <p>Wait until the market expires.</p>
            </div>
            <div className={agentState.phase === "running" ? "active" : ""}>
              <span>2</span>
              <p>{challenge.resolutionTool ? "Search and call the attached Pipedream tool for evidence." : "Search for evidence against the resolution criteria."}</p>
            </div>
            <div className={agentState.phase === "finished" ? "active" : ""}>
              <span>3</span>
              <p>Publish a provisional decision trail for everyone.</p>
            </div>
          </div>
        </div>

        {latestRun ? (
          <div className="agent-run-card">
            <div className="agent-run-summary">
              <div>
                <span>Decision</span>
                <strong className={latestRun.proposedOutcome.toLowerCase()}>{latestRun.proposedOutcome}</strong>
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
            <div className="agent-rationale">
              <h3><SearchCheck size={17} /> Public rationale</h3>
              <p>{latestRun.aiRationale}</p>
            </div>
            <div className="agent-query">
              <span>Evidence query</span>
              <code>{latestRun.exaQuery}</code>
            </div>
            <div className="agent-sources">
              <span>Sources</span>
              {latestRun.sourceUrls.length > 0 ? (
                <div>
                  {latestRun.sourceUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <ExternalLink size={15} /> {url}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="fine-print">No external sources were recorded for this run.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="fine-print">
            The agent run becomes visible here after expiry. Viewers will see the search query, sources, confidence, provisional decision, and public rationale.
          </p>
        )}
      </section>

      <section className="panel share-panel">
        <div className="section-title">
          <h2><Sparkles size={18} /> Share market</h2>
          <Button variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(window.location.href)} aria-label="Copy link">
            <Copy size={18} />
          </Button>
        </div>
        <div className="share-card challenge-share-card">
          <div>
            <span>{challenge.visibility === "private" ? "Private Moltbooky challenge" : "Moltbooky challenge"}</span>
            <strong>I’m taking {challenge.creatorSide} for {credits(challenge.stakeCents)}</strong>
            <p>{challenge.claim}</p>
          </div>
          <small>{credits(available)} still available to match on {takerSide}.</small>
        </div>
      </section>

      <section className="panel">
        <h2>Matches</h2>
        <div className="ledger-list">
          {matches.map((matchItem) => (
            <div key={matchItem.id}>
              <span>{matchItem.matcherName || matchItem.matcherId}</span>
              <strong>{credits(matchItem.amountCents)} {matchItem.side}</strong>
            </div>
          ))}
          {matches.length === 0 && <p className="fine-print">No one has taken the other side yet.</p>}
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
    <div className="page">
      <header className="page-header">
        <div className="skeleton-stack">
          <div className="row-meta">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-9 w-full max-w-[760px]" />
          <Skeleton className="h-5 w-full max-w-[640px]" />
        </div>
        <Skeleton className="h-10 w-10 shrink-0" />
      </header>

      <section className="detail-grid">
        <Card className="market-panel">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="mb-5 h-3 w-full rounded-full" />
            <div className="stats-grid">
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

        <Card className="trade-ticket">
          <CardHeader>
            <Skeleton className="h-6 w-28" />
          </CardHeader>
          <CardContent>
            <div className="side-card">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-9 w-16" />
            </div>
            <Skeleton className="mt-4 h-5 w-full" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-2 h-10 w-full" />
          </CardContent>
        </Card>
      </section>

      <section className="panel share-panel">
        <div className="section-title">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-10 w-10" />
        </div>
        <div className="share-card">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-full max-w-[640px]" />
          <Skeleton className="h-4 w-40" />
        </div>
      </section>

      <section className="panel">
        <Skeleton className="h-6 w-24" />
        <div className="ledger-list mt-4">
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
