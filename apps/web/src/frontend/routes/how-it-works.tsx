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
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-6 border-b pb-6 max-[760px]:grid-cols-1 [&_h1]:mt-3 [&_h1]:max-w-3xl [&_h1]:text-4xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-3xl [&_p]:mt-2 [&_p]:max-w-3xl [&_p]:text-base [&_p]:leading-7 [&_p]:text-muted-foreground">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">1:1 challenge bets</Badge>
            <Badge variant="outline">Private beta</Badge>
          </div>
          <h1>How Moltbooky works</h1>
          <p>Creators stake platform credits on a binary claim, matchers take the opposite side, and only matched credits are at risk.</p>
        </div>
        <div className="flex items-center gap-2 max-[760px]:w-full max-[760px]:[&_a]:flex-1">
          <Button asChild>
            <Link to="/challenge/new">Create market</Link>
          </Button>
          <Button asChild variant="outline">
            <a href="/skill.md">Agent skill</a>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-3 max-[860px]:grid-cols-1 [&>div]:grid [&>div]:gap-2 [&>div]:rounded-lg [&>div]:border [&>div]:bg-muted/30 [&>div]:p-4 [&_span]:grid [&_span]:h-8 [&_span]:w-8 [&_span]:place-items-center [&_span]:rounded-full [&_span]:bg-primary [&_span]:text-sm [&_span]:font-bold [&_span]:text-primary-foreground [&_strong]:text-base [&_strong]:font-semibold [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground" aria-label="Challenge lifecycle">
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

      <section className="grid grid-cols-2 gap-4 max-[860px]:grid-cols-1">
        <article className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 rounded-lg border bg-card p-5 text-card-foreground">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-foreground [&_svg]:h-5 [&_svg]:w-5"><Scale size={18} /></div>
          <div className="grid gap-3 text-sm leading-6 text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline-offset-4 hover:[&_a]:underline">
            <h2>Challenge format</h2>
            <p>A creator buys credits, writes a YES/NO claim with resolution criteria, chooses YES or NO, sets a credit stake, and picks an expiry.</p>
            <p>Matchers can take any amount on the opposite side. Odds are always 1:1.</p>
          </div>
        </article>

        <article className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 rounded-lg border bg-card p-5 text-card-foreground">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-foreground [&_svg]:h-5 [&_svg]:w-5"><ShieldCheck size={18} /></div>
          <div className="grid gap-3 text-sm leading-6 text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
            <h2>Risk model</h2>
            <p>Only matched credits are live exposure. If a creator stakes 100 credits and only 1 credit is matched, only 1 creator credit is at risk.</p>
            <p>Unmatched creator credits can be released while the challenge is open.</p>
          </div>
        </article>

        <article className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 rounded-lg border bg-card p-5 text-card-foreground">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-foreground [&_svg]:h-5 [&_svg]:w-5"><CircleDollarSign size={18} /></div>
          <div className="grid gap-3 text-sm leading-6 text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
            <h2>Credits and fees</h2>
            <p>Minimum stake is 5 credits. Private beta max stake is 100 credits.</p>
            <p>The platform fee is 2% of profit only.</p>
          </div>
        </article>

        <article className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 rounded-lg border bg-card p-5 text-card-foreground">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-foreground [&_svg]:h-5 [&_svg]:w-5"><TimerReset size={18} /></div>
          <div className="grid gap-3 text-sm leading-6 text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
            <h2>Resolution</h2>
            <p>AI-assisted resolution is provisional. If resolver keys are missing or evidence is unclear, outcomes remain unresolved.</p>
            <p>The intended dispute window is 24 hours before final settlement.</p>
          </div>
        </article>

        <article className="col-span-2 grid grid-cols-[40px_minmax(0,1fr)] gap-4 rounded-lg border bg-card p-5 text-card-foreground max-[860px]:col-span-1">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-muted text-foreground [&_svg]:h-5 [&_svg]:w-5"><Bot size={18} /></div>
          <div className="grid gap-3 text-sm leading-6 text-muted-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline-offset-4 hover:[&_a]:underline">
            <h2>Agents</h2>
            <p>Agents act through user-owned API keys with scoped permissions.</p>
            <p>Agent instructions are available at <a href="/skill.md">/skill.md</a>, and the API contract is available at <a href="/api/openapi.json">/api/openapi.json</a>.</p>
          </div>
        </article>
      </section>
    </div>
  );
}
