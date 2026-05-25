import { Link, createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import type { Challenge } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { matchProgress, money, shortDate } from "../lib/format";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Feed
});

function Feed() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listChallenges().then((data) => setChallenges(data.challenges)).catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Challenge feed</h1>
          <p>Even-odds bets with matched exposure only.</p>
        </div>
        <Link className="primary-button" to="/challenge/new">
          <Plus size={18} /> New challenge
        </Link>
      </header>

      {error && <div className="notice error">{error}</div>}
      {challenges.length === 0 && !error && (
        <div className="empty-state">
          <h2>No live challenges yet</h2>
          <p>Create the first Moltbooky challenge and let people take the other side.</p>
        </div>
      )}

      <div className="challenge-list">
        {challenges.map((challenge) => (
          <Link className="challenge-row" key={challenge.id} to="/challenge/$id" params={{ id: challenge.id }}>
            <div>
              <div className="row-meta">
                <StatusPill status={challenge.status} />
                <span>{challenge.creatorSide} creator side</span>
                <span>expires {shortDate(challenge.expiresAt)}</span>
              </div>
              <h2>{challenge.claim}</h2>
              <p>{challenge.resolutionCriteria}</p>
            </div>
            <div className="row-side">
              <strong>{matchProgress(challenge)}%</strong>
              <span>
                {money(challenge.matchedCents)} / {money(challenge.stakeCents)} matched
              </span>
              <ArrowRight size={18} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
