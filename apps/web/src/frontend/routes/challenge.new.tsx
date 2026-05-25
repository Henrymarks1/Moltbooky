import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, CircleDollarSign, TimerReset } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
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
    await navigate({ to: "/login" });
    setLoading(false);
  }

  return (
    <div className="page create-page">
      <header className="page-header">
        <div>
          <div className="row-meta">
            <Badge variant="outline">New market</Badge>
            <Badge variant="outline">Even odds</Badge>
          </div>
          <h1>Launch a market in under a minute.</h1>
          <p>Preview the market composer here. Log in or sign up to publish a challenge.</p>
        </div>
      </header>

      <form className="create-layout" onSubmit={submit}>
        <Card className="form">
          <CardHeader>
            <CardTitle>Market details</CardTitle>
          </CardHeader>
          <CardContent className="form">
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
            <span><CircleDollarSign size={15} /> Stake</span>
            <Input name="stakeDollars" inputMode="decimal" placeholder="25.00" required />
          </Label>
          <Label>
            <span><TimerReset size={15} /> Expiry</span>
            <Input name="expiresAt" type="datetime-local" required />
          </Label>
        </div>
          </CardContent>
        </Card>

        <Card className="form">
          <CardHeader>
            <CardTitle>Your side</CardTitle>
          </CardHeader>
          <CardContent className="form">
        <div className="composer-ticket">
          <span>Creator position</span>
          <strong>{creatorSide}</strong>
          <p>The counterparty receives the opposite side at the same stake.</p>
        </div>
        <div className="segmented side-segmented" role="group" aria-label="Creator side">
          <button type="button" className={creatorSide === "YES" ? "selected yes" : ""} onClick={() => setCreatorSide("YES")}>
            YES
          </button>
          <button type="button" className={creatorSide === "NO" ? "selected no" : ""} onClick={() => setCreatorSide("NO")}>
            NO
          </button>
        </div>
        <Button type="submit" disabled={loading}>
          <CheckCircle2 size={18} /> {loading ? "Opening..." : "Sign up to publish"}
        </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
