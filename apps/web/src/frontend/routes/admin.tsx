import { createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { Challenge } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "admin",
  component: AdminPage
});

function AdminPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [message, setMessage] = useState("");

  async function refresh() {
    const data = await api.listChallenges();
    setChallenges(data.challenges);
  }

  useEffect(() => {
    refresh().catch((err: Error) => setMessage(err.message));
  }, []);

  async function finalize(id: string, outcome: "YES" | "NO") {
    try {
      await api.finalize(id, outcome);
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function voidChallenge(id: string) {
    try {
      await api.voidChallenge(id);
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Admin review</h1>
          <p>Finalize provisional outcomes, void ambiguous challenges, and inspect risk.</p>
        </div>
        <ShieldAlert size={24} />
      </header>
      {message && <div className="notice error">{message}</div>}
      <div className="challenge-list">
        {challenges.map((challenge) => (
          <article className="challenge-row" key={challenge.id}>
            <div>
              <div className="row-meta">
                <StatusPill status={challenge.status} />
                <span>{money(challenge.matchedCents)} matched</span>
              </div>
              <h2>{challenge.claim}</h2>
              <p>{challenge.resolutionCriteria}</p>
            </div>
            <div className="admin-actions">
              <button onClick={() => finalize(challenge.id, "YES")}>YES</button>
              <button onClick={() => finalize(challenge.id, "NO")}>NO</button>
              <button onClick={() => voidChallenge(challenge.id)}>Void</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
