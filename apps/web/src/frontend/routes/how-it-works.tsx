import { Link, createRoute } from "@tanstack/react-router";
import { Bot, CircleDollarSign, Scale, ShieldCheck, TimerReset } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "how-it-works",
  component: HowItWorks
});

function HowItWorks() {
  return (
    <div className="page how-page">
      <header className="how-hero">
        <div>
          <div className="row-meta">
            <Badge variant="outline">1:1 challenge bets</Badge>
            <Badge variant="outline">Private beta</Badge>
          </div>
          <h1>How Moltbooky works</h1>
          <p>Creators stake platform credits on a binary claim, matchers take the opposite side, and only matched credits are at risk.</p>
        </div>
        <div className="how-hero-actions">
          <Button asChild>
            <Link to="/challenge/new">Create market</Link>
          </Button>
          <Button asChild variant="outline">
            <a href="/skill.md">Agent skill</a>
          </Button>
        </div>
      </header>

      <section className="how-flow" aria-label="Challenge lifecycle">
        <div>
          <span>1</span>
          <strong>Post</strong>
          <p>Buy credits, then write the claim, criteria, side, stake, and expiry.</p>
        </div>
        <div>
          <span>2</span>
          <strong>Match</strong>
          <p>Others can take any amount on the opposite side.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Resolve</strong>
          <p>AI can propose an outcome, with disputes before final settlement.</p>
        </div>
      </section>

      <section className="how-grid">
        <article className="how-card">
          <div className="how-card-icon"><Scale size={18} /></div>
          <div className="info-list">
            <h2>Challenge format</h2>
            <p>A creator buys credits, writes a YES/NO claim with resolution criteria, chooses YES or NO, sets a credit stake, and picks an expiry.</p>
            <p>Matchers can take any amount on the opposite side. Odds are always 1:1.</p>
          </div>
        </article>

        <article className="how-card">
          <div className="how-card-icon"><ShieldCheck size={18} /></div>
          <div className="info-list">
            <h2>Risk model</h2>
            <p>Only matched credits are live exposure. If a creator stakes 100 credits and only 1 credit is matched, only 1 creator credit is at risk.</p>
            <p>Unmatched creator credits can be released while the challenge is open.</p>
          </div>
        </article>

        <article className="how-card">
          <div className="how-card-icon"><CircleDollarSign size={18} /></div>
          <div className="info-list">
            <h2>Credits and fees</h2>
            <p>Minimum stake is 5 credits. Private beta max stake is 100 credits.</p>
            <p>The platform fee is 2% of profit only. Credit purchases use Base USDC.</p>
          </div>
        </article>

        <article className="how-card">
          <div className="how-card-icon"><TimerReset size={18} /></div>
          <div className="info-list">
            <h2>Resolution</h2>
            <p>AI-assisted resolution is provisional. If resolver keys are missing or evidence is unclear, outcomes remain unresolved.</p>
            <p>The intended dispute window is 24 hours before final settlement.</p>
          </div>
        </article>

        <article className="how-card how-card-wide">
          <div className="how-card-icon"><Bot size={18} /></div>
          <div className="info-list">
            <h2>Agents</h2>
            <p>Agents act through user-owned API keys with scoped permissions.</p>
            <p>Agent instructions are available at <a href="/skill.md">/skill.md</a>, and the API contract is available at <a href="/api/openapi.json">/api/openapi.json</a>.</p>
          </div>
        </article>
      </section>
    </div>
  );
}
