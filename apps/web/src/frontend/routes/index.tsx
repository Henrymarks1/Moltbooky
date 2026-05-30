import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Bot } from "lucide-react";
import type { Challenge } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { draftClaimKey } from "../lib/drafts";
import { credits, matchProgress, shortDate } from "../lib/format";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home
});

const promptExamples = [
  "will Henry land a job this month?",
  "will the Lakers make the playoffs?",
  "will BTC close above $100k on June 30?",
  "will OpenAI ship a new model this summer?",
  "will my flight arrive before 8pm?"
];

function Home() {
  const navigate = useNavigate();
  const [claim, setClaim] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [typedExample, setTypedExample] = useState("");
  const [publicMarkets, setPublicMarkets] = useState<Challenge[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState("");

  const activeExample = useMemo(() => promptExamples[exampleIndex], [exampleIndex]);

  useEffect(() => {
    if (typedExample.length < activeExample.length) {
      const timeout = window.setTimeout(() => {
        setTypedExample(activeExample.slice(0, typedExample.length + 1));
      }, 34);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      setTypedExample("");
      setExampleIndex((index) => (index + 1) % promptExamples.length);
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [activeExample, typedExample]);

  useEffect(() => {
    let active = true;

    async function loadPublicMarkets() {
      setMarketsLoading(true);
      setMarketsError("");
      try {
        const data = await api.listChallenges();
        if (active) {
          setPublicMarkets(data.challenges);
        }
      } catch (err) {
        if (active) {
          setMarketsError(err instanceof Error ? err.message : "Public markets could not be loaded.");
        }
      } finally {
        if (active) {
          setMarketsLoading(false);
        }
      }
    }

    void loadPublicMarkets();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = claim.trim();
    if (draft && typeof window !== "undefined") {
      window.sessionStorage.setItem(draftClaimKey, draft);
    }
    await navigate({ to: "/challenge/new" });
  }

  return (
    <div className="prompt-home">
      <section className="prompt-hero" aria-labelledby="prompt-home-title">
        <div className="prompt-heading">
          <Badge variant="outline">Agent-resolved markets</Badge>
          <h1 id="prompt-home-title">Bet on Anything</h1>
        </div>

        <form className="market-composer" onSubmit={submit}>
          <textarea
            aria-label="Describe a market"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            placeholder={typedExample}
            rows={4}
          />
          <div className="composer-actions">
            <div className="composer-mode">
              <Bot size={17} />
              <span>Resolver tools visible before launch</span>
            </div>
            <Button type="submit" size="icon" aria-label="Create market">
              <ArrowUp size={20} />
            </Button>
          </div>
        </form>

        <section className="public-markets-panel" aria-labelledby="public-markets-title">
          <div className="public-markets-header">
            <div>
              <h2 id="public-markets-title">Public markets</h2>
              <p>Open markets available to match right now.</p>
            </div>
            <Button asChild variant="ghost">
              <Link to="/my-bets">My bets</Link>
            </Button>
          </div>

          {marketsError && <div className="notice error">Public markets could not be loaded: {marketsError}</div>}

          <div className="public-markets-list">
            {marketsLoading && publicMarkets.length === 0 && <PublicMarketsSkeleton />}
            {!marketsLoading && publicMarkets.length === 0 && !marketsError && (
              <div className="public-markets-empty">
                <strong>No public markets yet</strong>
                <span>Create the first one from the prompt above.</span>
              </div>
            )}
            {publicMarkets.slice(0, 5).map((market) => (
              <Link className="public-market-row" key={market.id} to="/challenge/$id" params={{ id: market.id }}>
                <div>
                  <div className="row-meta">
                    <StatusPill status={market.status} />
                    <Badge variant="outline">Expires {shortDate(market.expiresAt)}</Badge>
                  </div>
                  <h3>{market.claim}</h3>
                  <p>{market.resolutionCriteria}</p>
                </div>
                <div className="market-depth">
                  <span>{credits(market.matchedCents)} matched</span>
                  <div className="mini-meter">
                    <span style={{ width: `${matchProgress(market)}%` }} />
                  </div>
                </div>
                <div className="row-side">
                  <strong>{credits(Math.max(0, market.stakeCents - market.matchedCents))}</strong>
                  <span>open</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

      </section>
    </div>
  );
}

function PublicMarketsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="public-market-row" key={index}>
          <div>
            <div className="row-meta">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-5 w-full max-w-[520px]" />
            <Skeleton className="mt-3 h-4 w-full max-w-[440px]" />
          </div>
          <div className="market-depth">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2 w-full min-w-[140px] rounded-full" />
          </div>
          <div className="row-side">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-4 w-10" />
          </div>
        </div>
      ))}
    </>
  );
}
