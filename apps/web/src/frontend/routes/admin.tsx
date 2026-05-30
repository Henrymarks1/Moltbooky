import { createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { Challenge } from "@moltbooky/core/domain/types";
import { StatusPill } from "../components/StatusPill";
import { Button } from "../components/ui/button";
import { api } from "../lib/api";
import { credits } from "../lib/format";
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
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex items-start justify-between gap-4 [&_h1]:max-w-[850px] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-2xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
        <div>
          <h1>Admin review</h1>
          <p>Finalize provisional outcomes, void ambiguous challenges, and inspect risk.</p>
        </div>
        <ShieldAlert size={24} />
      </header>
      {message && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{message}</div>}
      <div className="grid gap-3">
        {challenges.map((challenge) => (
          <article className="grid grid-cols-[minmax(0,1fr)_140px_170px] items-center gap-5 rounded-lg border bg-card p-4 text-card-foreground no-underline transition-colors hover:bg-muted/40 max-[900px]:grid-cols-1 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:tracking-tight [&_p]:mt-2 [&_p]:line-clamp-2 [&_p]:max-w-[760px] [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground" key={challenge.id}>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusPill status={challenge.status} />
                <span>{credits(challenge.matchedCents)} matched</span>
              </div>
              <h2>{challenge.claim}</h2>
              <p>{challenge.resolutionCriteria}</p>
            </div>
            <div className="grid grid-cols-3 content-center gap-2 max-[560px]:grid-cols-1">
              <Button variant="outline" onClick={() => finalize(challenge.id, "YES")}>YES</Button>
              <Button variant="outline" onClick={() => finalize(challenge.id, "NO")}>NO</Button>
              <Button variant="destructive" onClick={() => voidChallenge(challenge.id)}>Void</Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
