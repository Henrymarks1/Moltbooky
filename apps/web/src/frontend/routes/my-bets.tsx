import { Link, createRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { matchProgress, credits, shortDate } from "../lib/format";
import { authChangeEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/my-bets",
  component: MyBetsPage
});

function MyBetsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [matches, setMatches] = useState<ChallengeMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refreshBets() {
    setLoading(true);
    setError("");
    try {
      const data = await api.listMyChallenges();
      setChallenges(data.challenges);
      setMatches(data.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your bets could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshBets();
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshAuth() {
      const currentUser = await getCurrentUser();
      if (active) {
        setUser(currentUser);
        setAuthLoaded(true);
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

  const bets = useMemo(
    () => (user ? challenges.filter((challenge) => challenge.creatorId === user.id || matches.some((match) => match.challengeId === challenge.id)) : []),
    [challenges, matches, user]
  );
  const createdBets = useMemo(
    () => (user ? bets.filter((challenge) => challenge.creatorId === user.id) : []),
    [bets, user]
  );
  const matchedBets = useMemo(
    () => bets.filter((challenge) => challenge.creatorId !== user?.id && matches.some((match) => match.challengeId === challenge.id)),
    [bets, matches, user]
  );
  const matchedAmountByChallenge = useMemo(
    () =>
      matches.reduce<Record<string, number>>((amounts, match) => {
        amounts[match.challengeId] = (amounts[match.challengeId] ?? 0) + match.amountCents;
        return amounts;
      }, {}),
    [matches]
  );
  const lockedStakeCents = useMemo(
    () =>
      createdBets.reduce((total, challenge) => total + challenge.stakeCents, 0) +
      matches.reduce((total, match) => total + match.amountCents, 0),
    [createdBets, matches]
  );

  if (authLoaded && !user) {
    return (
      <div className="page narrow">
        <section className="empty-state">
          <h2>Log in to see your bets</h2>
          <p>Your created and matched markets will appear here once you are signed in.</p>
          <Button asChild>
            <Link to="/login">Log in</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <div>
          <h1>My bets</h1>
          <p>Markets you created or matched, with stake, matching progress, and resolution status in one place.</p>
        </div>
        <div className="hero-actions">
          <Button variant="secondary" size="icon" onClick={refreshBets} aria-label="Refresh my bets" disabled={loading}>
            <RefreshCw size={18} />
          </Button>
          <Button asChild>
            <Link to="/challenge/new">
              <Plus size={18} />
              Create bet
            </Link>
          </Button>
        </div>
      </header>

      {error && <div className="notice error">Your bets could not be loaded: {error}</div>}

      <section className="stats-grid my-bets-stats">
        {loading && bets.length === 0 ? (
          <MyBetsStatsSkeleton />
        ) : (
          <>
            <div>
              <span>Markets</span>
              <strong>{bets.length}</strong>
            </div>
            <div>
              <span>Created</span>
              <strong>{createdBets.length}</strong>
            </div>
            <div>
              <span>Matched</span>
              <strong>{matchedBets.length}</strong>
            </div>
            <div>
              <span>Your stake</span>
              <strong>{credits(lockedStakeCents)}</strong>
            </div>
          </>
        )}
      </section>

      <section className="challenge-list">
        {loading && bets.length === 0 && <MyBetsListSkeleton />}
        {!loading && bets.length === 0 && (
          <div className="empty-state">
            <h2>No bets yet</h2>
            <p>Create or match a market and it will show up here for quick tracking.</p>
            <Button asChild>
              <Link to="/challenge/new">Create your first bet</Link>
            </Button>
          </div>
        )}
        {bets.map((challenge) => {
          const isCreator = challenge.creatorId === user?.id;
          const userMatchedCents = matchedAmountByChallenge[challenge.id] ?? 0;
          const userSide = isCreator ? challenge.creatorSide : oppositeSide(challenge.creatorSide);
          return (
            <Link className="challenge-row" key={challenge.id} to="/challenge/$id" params={{ id: challenge.id }}>
              <div>
                <div className="row-meta">
                  <StatusPill status={challenge.status} />
                  <Badge variant="outline">{challenge.visibility === "private" ? "Private" : "Public"}</Badge>
                  <Badge variant="outline">{isCreator ? "Created" : "Matched"}</Badge>
                  <Badge variant="outline">You bet {userSide}</Badge>
                  <span>Expires {shortDate(challenge.expiresAt)}</span>
                </div>
                <h2>{challenge.claim}</h2>
                <p>{challenge.resolutionCriteria}</p>
              </div>
              <div className="market-depth">
                <span>{credits(challenge.matchedCents)} matched</span>
                <div className="mini-meter">
                  <span style={{ width: `${matchProgress(challenge)}%` }} />
                </div>
              </div>
              <div className="row-side">
                <strong>{credits(isCreator ? challenge.stakeCents : userMatchedCents)}</strong>
                <span>{isCreator ? "creator stake" : "your match"}</span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

function MyBetsStatsSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
        </div>
      ))}
    </>
  );
}

function MyBetsListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="challenge-row" key={index}>
          <div>
            <div className="row-meta">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="mt-3 h-6 w-full max-w-[660px]" />
            <Skeleton className="mt-3 h-4 w-full max-w-[520px]" />
          </div>
          <div className="market-depth">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2 w-full min-w-[140px] rounded-full" />
          </div>
          <div className="row-side">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </>
  );
}
