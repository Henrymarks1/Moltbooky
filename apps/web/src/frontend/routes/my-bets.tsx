import { Link, createRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { Challenge } from "@moltbooky/core/domain/types";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refreshBets() {
    setLoading(true);
    setError("");
    try {
      const data = await api.listMyChallenges();
      setChallenges(data.challenges);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Created bets could not be loaded.");
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

  const createdBets = useMemo(
    () => (user ? challenges.filter((challenge) => challenge.creatorId === user.id) : []),
    [challenges, user]
  );

  if (authLoaded && !user) {
    return (
      <div className="page narrow">
        <section className="empty-state">
          <h2>Log in to see your bets</h2>
          <p>Your created markets will appear here once you are signed in.</p>
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
          <p>Markets you created, with stake, matching progress, and resolution status in one place.</p>
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

      {error && <div className="notice error">Created bets could not be loaded: {error}</div>}

      <section className="stats-grid my-bets-stats">
        {loading && createdBets.length === 0 ? (
          <MyBetsStatsSkeleton />
        ) : (
          <>
            <div>
              <span>Created</span>
              <strong>{createdBets.length}</strong>
            </div>
            <div>
              <span>Creator stake</span>
              <strong>{credits(createdBets.reduce((total, challenge) => total + challenge.stakeCents, 0))}</strong>
            </div>
            <div>
              <span>Matched</span>
              <strong>{credits(createdBets.reduce((total, challenge) => total + challenge.matchedCents, 0))}</strong>
            </div>
            <div>
              <span>Open</span>
              <strong>{createdBets.filter((challenge) => challenge.status === "open").length}</strong>
            </div>
          </>
        )}
      </section>

      <section className="challenge-list">
        {loading && createdBets.length === 0 && <MyBetsListSkeleton />}
        {!loading && createdBets.length === 0 && (
          <div className="empty-state">
            <h2>No bets created yet</h2>
            <p>Create a market and it will show up here for quick tracking.</p>
            <Button asChild>
              <Link to="/challenge/new">Create your first bet</Link>
            </Button>
          </div>
        )}
        {createdBets.map((challenge) => (
          <Link className="challenge-row" key={challenge.id} to="/challenge/$id" params={{ id: challenge.id }}>
            <div>
              <div className="row-meta">
                <StatusPill status={challenge.status} />
                <Badge variant="outline">{challenge.visibility === "private" ? "Private" : "Public"}</Badge>
                <Badge variant="outline">You bet {challenge.creatorSide}</Badge>
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
              <strong>{credits(challenge.stakeCents)}</strong>
              <span>creator stake</span>
            </div>
          </Link>
        ))}
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
