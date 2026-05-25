import { createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, RefreshCw, RotateCcw } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { api } from "../lib/api";
import { matchProgress, money, shortDate } from "../lib/format";
import { rootRoute } from "./root";

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
  const [amount, setAmount] = useState("10.00");
  const [message, setMessage] = useState("");

  async function refresh() {
    const data = await api.getChallenge(id);
    setChallenge(data.challenge);
    setMatches(data.matches);
    setAvailable(data.availableToMatchCents);
  }

  useEffect(() => {
    refresh().catch((err: Error) => setMessage(err.message));
  }, [id]);

  async function match() {
    setMessage("");
    try {
      await api.matchChallenge(id, amount);
      await refresh();
      setMessage("Matched. Only that amount is at risk.");
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function cancel() {
    try {
      const result = await api.cancelUnmatched(id);
      await refresh();
      setMessage(`Released ${money(result.unlockedCents)} of unmatched stake.`);
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  if (!challenge) {
    return <div className="page">Loading challenge...</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="row-meta">
            <StatusPill status={challenge.status} />
            <span>expires {shortDate(challenge.expiresAt)}</span>
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
        <div className="panel">
          <h2>Exposure</h2>
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
          <p className="fine-print">Only matched funds are at risk. Unmatched creator stake can be released while the challenge remains open.</p>
        </div>

        <div className="panel">
          <h2>Take the other side</h2>
          <p className="large-side">{oppositeSide(challenge.creatorSide)}</p>
          <Label>
            Match amount
            <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          </Label>
          <Button onClick={match}>
            Match 1:1
          </Button>
          <Button variant="secondary" onClick={cancel}>
            <RotateCcw size={18} /> Release unmatched
          </Button>
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Share card</h2>
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
