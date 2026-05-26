import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, CircleDollarSign, Globe2, Link2, TimerReset } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { api } from "../lib/api";
import { draftClaimKey } from "../lib/drafts";
import { authChangeEvent } from "./root";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "challenge/new",
  component: NewChallenge
});

function toIsoDateTime(value: FormDataEntryValue | null): string {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}

function NewChallenge() {
  const navigate = useNavigate();
  const [draftClaim] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const draft = window.sessionStorage.getItem(draftClaimKey) ?? "";
    window.sessionStorage.removeItem(draftClaimKey);
    return draft;
  });
  const [creatorSide, setCreatorSide] = useState<"YES" | "NO">("YES");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const { challenge } = await api.createChallenge({
        claim: String(form.get("claim") ?? ""),
        resolutionCriteria: String(form.get("resolutionCriteria") ?? ""),
        creatorSide,
        visibility,
        stakeCredits: String(form.get("stakeCredits") ?? ""),
        expiresAt: toIsoDateTime(form.get("expiresAt"))
      });
      window.dispatchEvent(new Event(authChangeEvent));
      await navigate({ to: "/challenge/$id", params: { id: challenge.id } });
    } catch (err) {
      const message = (err as Error).message;
      if (message.toLowerCase().includes("sign in")) {
        await navigate({ to: "/login" });
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
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
          <p>Post a claim, choose your side, and lock platform credits for matching.</p>
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
          <Textarea
            name="claim"
            placeholder="I bet YES that OpenAI launches a new model by June 30, 2026."
            defaultValue={draftClaim}
            required
          />
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
            <Input name="stakeCredits" inputMode="decimal" placeholder="25.00" required />
          </Label>
          <Label>
            <span><TimerReset size={15} /> Expiry</span>
            <Input name="expiresAt" type="datetime-local" required />
            <small className="field-help">Uses your local timezone and saves as UTC.</small>
          </Label>
        </div>
          </CardContent>
        </Card>

        <Card className="form">
          <CardHeader>
            <CardTitle>Position and access</CardTitle>
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
        <div className="composer-ticket">
          <span>{visibility === "public" ? "Public bet" : "Private bet"}</span>
          <strong>{visibility === "public" ? "Listed" : "Share link"}</strong>
          <p>
            {visibility === "public"
              ? "Visible in the public market feed and accessible by link."
              : "Hidden from the public feed. Anyone with the share link can open it."}
          </p>
        </div>
        <div className="segmented visibility-segmented" role="group" aria-label="Bet visibility">
          <button type="button" className={visibility === "public" ? "selected" : ""} onClick={() => setVisibility("public")}>
            <Globe2 size={16} /> Public
          </button>
          <button type="button" className={visibility === "private" ? "selected" : ""} onClick={() => setVisibility("private")}>
            <Link2 size={16} /> Private
          </button>
        </div>
        <Button type="submit" disabled={loading}>
          <CheckCircle2 size={18} /> {loading ? "Publishing..." : "Publish challenge"}
        </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
