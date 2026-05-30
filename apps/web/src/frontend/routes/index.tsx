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

const publicMarketRowClass =
  "grid grid-cols-[minmax(0,1fr)_140px_120px] items-center gap-4 rounded-md border bg-background p-3 text-foreground no-underline transition-colors hover:bg-muted/40 max-[820px]:grid-cols-1";

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
    await navigate({ to: "/new" });
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-65px)] w-full max-w-6xl place-items-center px-4 py-10">
      <section className="grid w-full max-w-4xl gap-5" aria-labelledby="prompt-home-title">
        <div className="grid justify-items-center gap-4 text-center">
          <Badge variant="outline">Agent-resolved markets</Badge>
          <h1 id="prompt-home-title" className="text-5xl font-bold tracking-normal text-foreground max-[720px]:text-4xl">Bet on Anything</h1>
        </div>

        <form className="grid min-h-[210px] overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-[0_24px_80px_rgba(15,23,42,0.10)]" onSubmit={submit}>
          <textarea
            className="min-h-[146px] resize-none border-0 bg-transparent px-6 py-5 text-lg leading-8 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 max-[560px]:px-4 max-[560px]:text-base"
            aria-label="Describe a market"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            placeholder={typedExample}
            rows={4}
          />
          <div className="flex min-h-16 items-center justify-between gap-3 border-t bg-muted/35 px-4 py-3">
            <div className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground [&_span]:truncate">
              <Bot size={17} />
              <span>Resolver tools visible before launch</span>
            </div>
            <Button type="submit" size="icon" aria-label="Create market">
              <ArrowUp size={20} />
            </Button>
          </div>
        </form>

        <section className="grid gap-3 rounded-lg border bg-card p-4 text-card-foreground" aria-labelledby="public-markets-title">
          <div className="flex items-start justify-between gap-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:mt-1 [&_p]:text-sm [&_p]:text-muted-foreground">
            <div>
              <h2 id="public-markets-title">Public markets</h2>
              <p>Open markets available to match right now.</p>
            </div>
            <Button asChild variant="ghost">
              <Link to="/my-bets">My bets</Link>
            </Button>
          </div>

          {marketsError && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Public markets could not be loaded: {marketsError}</div>}

          <div className="grid gap-2">
            {marketsLoading && publicMarkets.length === 0 && <PublicMarketsSkeleton />}
            {!marketsLoading && publicMarkets.length === 0 && !marketsError && (
              <div className="grid gap-1 rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground [&_strong]:text-foreground">
                <strong>No public markets yet</strong>
                <span>Create the first one from the prompt above.</span>
              </div>
            )}
            {publicMarkets.slice(0, 5).map((market) => (
              <Link className={publicMarketRowClass} key={market.id} to="/challenge/$id" params={{ id: market.id }}>
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusPill status={market.status} />
                    <Badge variant="outline">Expires {shortDate(market.expiresAt)}</Badge>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold leading-snug tracking-normal">{market.claim}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{market.resolutionCriteria}</p>
                </div>
                <div className="grid gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{credits(market.matchedCents)} matched</span>
                  <div className="h-2 w-full min-w-[140px] overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${matchProgress(market)}%` }} />
                  </div>
                </div>
                <div className="grid justify-items-end gap-2 max-[900px]:justify-items-start">
                  <strong className="text-2xl font-semibold leading-none">{credits(Math.max(0, market.stakeCents - market.matchedCents))}</strong>
                  <span className="text-xs font-semibold text-muted-foreground">open</span>
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
        <div className={publicMarketRowClass} key={index}>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-5 w-full max-w-[520px]" />
            <Skeleton className="mt-3 h-4 w-full max-w-[440px]" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2 w-full min-w-[140px] rounded-full" />
          </div>
          <div className="grid justify-items-end gap-2 max-[900px]:justify-items-start">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-4 w-10" />
          </div>
        </div>
      ))}
    </>
  );
}
