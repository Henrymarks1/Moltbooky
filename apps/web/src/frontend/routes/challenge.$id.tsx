import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Flame, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch } from "@moltbooky/core/domain/types";
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
  const [available, setAvailable] = useState(0);
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [matchCredits, setMatchCredits] = useState("5");
  const [matching, setMatching] = useState(false);

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
      <header className="challenge-hero">
        <div className="challenge-hero-copy">
          <div className="row-meta">
            <StatusPill status={challenge.status} />
            <Badge variant="outline">Expires {shortDate(challenge.expiresAt)}</Badge>
            <Badge variant="outline">{challenge.visibility === "private" ? "Private link" : "Public"}</Badge>
            <Badge variant="outline">1:1 odds</Badge>
          </div>
          <h1>{challenge.claim}</h1>
          <p>{challenge.resolutionCriteria}</p>
        </div>
        <div className="challenge-hero-card">
          <span>Creator is taking</span>
          <strong className={creatorSideClass}>{challenge.creatorSide}</strong>
          <div>
            <span>{credits(challenge.stakeCents)} stake</span>
            <span>{credits(available)} open</span>
          </div>
        </div>
        <div className="challenge-hero-actions">
          <Button variant="secondary" size="icon" onClick={refresh} aria-label="Refresh challenge">
            <RefreshCw size={18} />
          </Button>
          <Button variant="secondary" size="icon" onClick={() => navigator.clipboard.writeText(window.location.href)} aria-label="Copy link">
            <Copy size={18} />
          </Button>
        </div>
      </header>

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
              <span>{matchItem.matcherId}</span>
              <strong>{credits(matchItem.amountCents)} {matchItem.side}</strong>
            </div>
          ))}
          {matches.length === 0 && <p className="fine-print">No one has taken the other side yet.</p>}
        </div>
      </section>
    </div>
  );
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
