import { Link, createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { api } from "../lib/api";
import { matchProgress, money, shortDate } from "../lib/format";
import { authChangeEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "challenge/$id",
  component: ChallengeDetail
});

function ChallengeDetail() {
  const { id } = Route.useParams();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [matches, setMatches] = useState<ChallengeMatch[]>([]);
  const [available, setAvailable] = useState(0);
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);

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
    return <div className="page loading-page">Loading market...</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="row-meta">
            <StatusPill status={challenge.status} />
            <Badge variant="outline">Expires {shortDate(challenge.expiresAt)}</Badge>
            <Badge variant="outline">1:1 odds</Badge>
          </div>
          <h1>{challenge.claim}</h1>
          <p>{challenge.resolutionCriteria}</p>
        </div>
        <Button variant="secondary" size="icon" onClick={refresh} aria-label="Refresh challenge">
          <RefreshCw size={18} />
        </Button>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="detail-grid">
        <Card className="market-panel">
          <CardHeader>
            <CardTitle>Market depth</CardTitle>
          </CardHeader>
          <CardContent>
          <div className="meter">
            <span style={{ width: `${matchProgress(challenge)}%` }} />
          </div>
          <div className="stats-grid">
            <div>
              <span>Creator side</span>
              <strong>{challenge.creatorSide}</strong>
            </div>
            <div>
              <span>Matched</span>
              <strong>{money(challenge.matchedCents)}</strong>
            </div>
            <div>
              <span>Available</span>
              <strong>{money(available)}</strong>
            </div>
            <div>
              <span>Stake</span>
              <strong>{money(challenge.stakeCents)}</strong>
            </div>
          </div>
          <p className="fine-print"><ShieldCheck size={15} /> Only matched funds are at risk. Unmatched creator stake can be released while the market remains open.</p>
          </CardContent>
        </Card>

        <Card className="trade-ticket">
          <CardHeader>
            <CardTitle>Trade ticket</CardTitle>
          </CardHeader>
          <CardContent>
          <div className="side-card">
            <span>Take</span>
            <strong>{oppositeSide(challenge.creatorSide)}</strong>
          </div>
          <p className="fine-print">
            {user ? "Match the opposite side at 1:1 odds, or create your own challenge." : "Log in or sign up to match this market, release stake, or create your own challenge."}
          </p>
          {user ? (
            <>
              <Button type="button">Match market</Button>
              <Button asChild variant="outline">
                <Link to="/challenge/new">Create market</Link>
              </Button>
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
        <div className="share-card">
          <strong>I bet {money(challenge.stakeCents)} {challenge.creatorSide}</strong>
          <span>{challenge.claim}</span>
          <small>{money(available)} still available to match.</small>
        </div>
      </section>

      <section className="panel">
        <h2>Matches</h2>
        <div className="ledger-list">
          {matches.map((matchItem) => (
            <div key={matchItem.id}>
              <span>{matchItem.matcherId}</span>
              <strong>{money(matchItem.amountCents)} {matchItem.side}</strong>
            </div>
          ))}
          {matches.length === 0 && <p className="fine-print">No one has taken the other side yet.</p>}
        </div>
      </section>
    </div>
  );
}
