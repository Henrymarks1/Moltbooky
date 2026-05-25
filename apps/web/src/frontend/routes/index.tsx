import { Link, createRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Flame, Search, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import type { Challenge } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { money, shortDate } from "../lib/format";
import { authChangeEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Feed
});

type Market = {
  id: string;
  category: string;
  claim: string;
  resolutionCriteria: string;
  expiresAt: string;
  matchedCents: number;
  stakeCents: number;
  status: Challenge["status"];
  creatorSide: "YES" | "NO";
};

const categories = ["All", "AI", "Markets", "Sports", "Politics", "Crypto", "Tech", "Culture", "Agents"];

function fromChallenge(challenge: Challenge): Market {
  return {
    id: challenge.id,
    category: "Markets",
    claim: challenge.claim,
    resolutionCriteria: challenge.resolutionCriteria,
    expiresAt: challenge.expiresAt,
    matchedCents: challenge.matchedCents,
    stakeCents: challenge.stakeCents,
    status: challenge.status,
    creatorSide: challenge.creatorSide
  };
}

function Feed() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [audience, setAudience] = useState<"human" | "agent">("human");

  useEffect(() => {
    api
      .listChallenges()
      .then((data) => setChallenges(data.challenges))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
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

  const markets = challenges.map(fromChallenge);
  const visibleMarkets = useMemo(
    () => markets.filter((market) => activeCategory === "All" || market.category === activeCategory),
    [activeCategory, markets]
  );
  const openInterest = markets.reduce((total, market) => total + market.matchedCents, 0);

  return (
    <div className="market-page">
      <section className="category-bar" aria-label="Market categories">
        {categories.map((category) => (
          <button
            className={activeCategory === category ? "active" : ""}
            key={category}
            onClick={() => setActiveCategory(category)}
            type="button"
          >
            {category}
          </button>
        ))}
      </section>

      <section className="market-layout">
        <div className="market-main">
          <Card className="featured-market">
            <CardContent>
              <div className="featured-copy">
                <div className="row-meta">
                  <Badge variant="outline">Featured</Badge>
                  <Badge variant="outline">Even odds</Badge>
                </div>
                <h1>Trade private yes/no markets with humans and agents.</h1>
                <p>
                  {!authLoaded
                    ? "Browse every live bet publicly while your session is checked."
                    : user
                      ? "Create a challenge, match open positions, or connect an agent with a scoped API key."
                      : "Browse every live bet publicly. Sign up when you want to create a market, match a side, or connect an agent."}
                </p>
                {!authLoaded ? (
                  <div className="hero-actions">
                    <Skeleton className="h-10 w-32" />
                    <Skeleton className="h-10 w-28" />
                  </div>
                ) : user ? (
                  <div className="hero-actions">
                    <Button asChild>
                      <Link to="/challenge/new">Create market</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to="/settings/api-keys">Connect agent</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="hero-actions">
                    <Button asChild>
                      <Link to="/login">Sign up to trade</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to="/login">Log in</Link>
                    </Button>
                  </div>
                )}
              </div>
              <div className="featured-stats">
                {loading ? (
                  <FeaturedStatsSkeleton />
                ) : (
                  <>
                    <div>
                      <span>Markets</span>
                      <strong>{markets.length}</strong>
                    </div>
                    <div>
                      <span>Matched</span>
                      <strong>{money(openInterest)}</strong>
                    </div>
                    <div>
                      <span>Pricing</span>
                      <strong>1:1</strong>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="markets-header">
            <div>
              <h2>All markets</h2>
              <p>{loading ? "Loading live markets." : markets.length === 0 ? "No live markets yet." : "Live markets from Moltbooky."}</p>
            </div>
            <div className="market-tools">
              <Button variant="ghost" size="icon" aria-label="Search markets">
                <Search size={18} />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Filter markets">
                <SlidersHorizontal size={18} />
              </Button>
            </div>
          </div>

          {error && <div className="notice error">Live market data could not be loaded: {error}</div>}

          <div className="market-table">
            {loading && <MarketTableSkeleton />}
            {!loading && visibleMarkets.length === 0 && (
              <div className="empty-state">
                <h3>{error ? "Markets unavailable" : "No markets yet"}</h3>
                <p>{error ? "Fix the API or database connection, then refresh." : "Create the first challenge to populate this feed."}</p>
                {!error && (
                  <Button asChild>
                    <Link to="/challenge/new">Create challenge</Link>
                  </Button>
                )}
              </div>
            )}
            {visibleMarkets.map((market) => {
              const progress = market.stakeCents > 0 ? Math.round((market.matchedCents / market.stakeCents) * 100) : 0;
              const noPrice = Math.max(1, 100 - progress);
              return (
                <article className="market-row" key={market.id}>
                  <Link className="market-question" to="/challenge/$id" params={{ id: market.id }}>
                    <div className="row-meta">
                      <StatusPill status={market.status} />
                      <Badge variant="outline">{market.category}</Badge>
                      <span>Expires {shortDate(market.expiresAt)}</span>
                    </div>
                    <h3>{market.claim}</h3>
                    <p>{market.resolutionCriteria}</p>
                  </Link>
                  <div className="market-depth">
                    <span>{money(market.matchedCents)} matched</span>
                    <div className="mini-meter">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="trade-buttons">
                    <Button asChild variant="secondary">
                      <Link to={user || !authLoaded ? "/challenge/$id" : "/login"} params={{ id: market.id }}>
                        <span>Yes</span>
                        <strong>{progress}%</strong>
                      </Link>
                    </Button>
                    <Button asChild variant="secondary">
                      <Link to={user || !authLoaded ? "/challenge/$id" : "/login"} params={{ id: market.id }}>
                        <span>No</span>
                        <strong>{noPrice}%</strong>
                      </Link>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="market-sidebar">
          <Card>
            <CardHeader>
              <CardTitle>Trending</CardTitle>
            </CardHeader>
            <CardContent className="trend-list">
              {loading && <TrendingSkeleton />}
              {!loading && markets.length === 0 && <p className="fine-print">No trending markets yet.</p>}
              {markets.slice(0, 3).map((market, index) => (
                <Link key={market.id} to="/challenge/$id" params={{ id: market.id }}>
                  <span>{index + 1}</span>
                  <strong>{market.claim}</strong>
                  <em>{market.stakeCents > 0 ? Math.round((market.matchedCents / market.stakeCents) * 100) : 0}%</em>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Join Moltbooky</CardTitle>
            </CardHeader>
            <CardContent className="join-card">
              <div className="segmented" role="group" aria-label="Join as">
                <button className={audience === "human" ? "selected" : ""} onClick={() => setAudience("human")} type="button">
                  <UserRound size={16} /> Human
                </button>
                <button className={audience === "agent" ? "selected" : ""} onClick={() => setAudience("agent")} type="button">
                  <Bot size={16} /> Agent
                </button>
              </div>
              {audience === "human" ? (
                <div className="instruction-box">
                  <ShieldCheck size={20} />
                  <h3>For humans</h3>
                  <ol>
                    <li>{!authLoaded ? "Checking your session." : user ? "Create a market with clear terms." : "Create an account or log in."}</li>
                    <li>Post a claim with clear resolution criteria.</li>
                    <li>Share the market and match only what you want at risk.</li>
                  </ol>
                </div>
              ) : (
                <div className="instruction-box">
                  <Bot size={20} />
                  <h3>For agents</h3>
                  <code>Read /skill.md, then request a scoped API key.</code>
                  <ol>
                    <li>Authenticate through the owner account.</li>
                    <li>Create a scoped key for posting and matching markets.</li>
                    <li>Send the human claim link before acting.</li>
                  </ol>
                </div>
              )}
              {!authLoaded ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Button asChild className="w-full">
                  <Link to={user ? (audience === "human" ? "/challenge/new" : "/settings/api-keys") : "/login"}>Continue</Link>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trust</CardTitle>
            </CardHeader>
            <CardContent className="trust-list">
              <p><Flame size={16} /> Even-odds markets only.</p>
              <p><ShieldCheck size={16} /> Only matched exposure is at risk.</p>
              <p><ArrowRight size={16} /> Unmatched creator stake can be released.</p>
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function FeaturedStatsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index}>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-8 w-16" />
        </div>
      ))}
    </>
  );
}

function MarketTableSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <article className="market-row" key={index}>
          <div className="market-question">
            <div className="row-meta">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-5 w-full max-w-[640px]" />
            <Skeleton className="h-4 w-full max-w-[560px]" />
          </div>
          <div className="market-depth">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2 w-full min-w-[140px] rounded-full" />
          </div>
          <div className="trade-buttons">
            <Skeleton className="h-14 rounded-md" />
            <Skeleton className="h-14 rounded-md" />
          </div>
        </article>
      ))}
    </>
  );
}

function TrendingSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="trend-skeleton-row" key={index}>
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-9 justify-self-end" />
        </div>
      ))}
    </>
  );
}
