import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "challenge/new",
  component: NewChallenge
});

function NewChallenge() {
  const navigate = useNavigate();
  const [creatorSide, setCreatorSide] = useState<"YES" | "NO">("YES");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const { challenge } = await api.createChallenge({
        claim: String(form.get("claim")),
        resolutionCriteria: String(form.get("resolutionCriteria")),
        stakeDollars: String(form.get("stakeDollars")),
        expiresAt: String(form.get("expiresAt")),
        creatorSide
      });
      await navigate({ to: "/challenge/$id", params: { id: challenge.id } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <div>
          <h1>Post a challenge</h1>
          <p>Put money behind a claim and share the opposite side.</p>
        </div>
      </header>

      <form className="panel form" onSubmit={submit}>
        {error && <div className="notice error">{error}</div>}
        <Label>
          Claim
          <Textarea name="claim" placeholder="I bet YES that OpenAI launches a new model by June 30, 2026." required />
        </Label>
        <Label>
          Resolution criteria
          <Textarea
            name="resolutionCriteria"
            placeholder="Resolve YES only if OpenAI announces general availability on its official site or API docs before the expiry."
            required
          />
        </Label>
        <div className="two-col">
          <Label>
            Stake
            <Input name="stakeDollars" inputMode="decimal" placeholder="25.00" required />
          </Label>
          <Label>
            Expiry
            <Input name="expiresAt" type="datetime-local" required />
          </Label>
        </div>
        <div className="segmented" role="group" aria-label="Creator side">
          <button type="button" className={creatorSide === "YES" ? "selected" : ""} onClick={() => setCreatorSide("YES")}>
            YES
          </button>
          <button type="button" className={creatorSide === "NO" ? "selected" : ""} onClick={() => setCreatorSide("NO")}>
            NO
          </button>
        </div>
        <Button type="submit" disabled={loading}>
          <CheckCircle2 size={18} /> {loading ? "Posting..." : "Post challenge"}
        </Button>
      </form>
    </div>
  );
}
