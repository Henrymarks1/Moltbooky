import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Bot, Clock3, FileSearch, Globe2, Scale, SearchCheck, ShieldCheck } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { draftClaimKey } from "../lib/drafts";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home
});

const promptExamples = [
  "will Henry land a job this month?",
  "will the Lakers make the playoffs?",
  "will BTC close above $100k on June 30?",
  "will OpenAI ship a new model this summer?",
  "will my flight arrive before 8pm?"
];

const resolverTools = [
  {
    icon: SearchCheck,
    label: "Web search",
    detail: "Find public evidence"
  },
  {
    icon: FileSearch,
    label: "Primary sources",
    detail: "Prefer official records"
  },
  {
    icon: Clock3,
    label: "Expiry clock",
    detail: "Check timing precisely"
  },
  {
    icon: Globe2,
    label: "Public links",
    detail: "Cite what it used"
  },
  {
    icon: ShieldCheck,
    label: "Rules",
    detail: "Follow market terms"
  },
  {
    icon: Scale,
    label: "Review",
    detail: "Escalate disputes"
  }
];

function Home() {
  const navigate = useNavigate();
  const [claim, setClaim] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [typedExample, setTypedExample] = useState("");

  const activeExample = useMemo(() => promptExamples[exampleIndex], [exampleIndex]);

  useEffect(() => {
    if (typedExample.length < activeExample.length) {
      const timeout = window.setTimeout(() => {
        setTypedExample(activeExample.slice(0, typedExample.length + 1));
      }, 34);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => {
      setTypedExample("");
      setExampleIndex((index) => (index + 1) % promptExamples.length);
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [activeExample, typedExample]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = claim.trim();
    if (draft && typeof window !== "undefined") {
      window.sessionStorage.setItem(draftClaimKey, draft);
    }
    await navigate({ to: "/challenge/new" });
  }

  return (
    <div className="prompt-home">
      <section className="prompt-hero" aria-labelledby="prompt-home-title">
        <div className="prompt-heading">
          <Badge variant="outline">Agent-resolved markets</Badge>
          <h1 id="prompt-home-title">Bet on Anything</h1>
        </div>

        <form className="market-composer" onSubmit={submit}>
          <textarea
            aria-label="Describe a market"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            placeholder={typedExample}
            rows={4}
          />
          <div className="composer-actions">
            <div className="composer-mode">
              <Bot size={17} />
              <span>Resolver tools visible before launch</span>
            </div>
            <Button type="submit" size="icon" aria-label="Create market">
              <ArrowUp size={20} />
            </Button>
          </div>
        </form>

        <div className="resolver-tools" aria-label="Resolver tools">
          {resolverTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <div key={tool.label}>
                <Icon size={18} />
                <span>
                  <strong>{tool.label}</strong>
                  <small>{tool.detail}</small>
                </span>
              </div>
            );
          })}
        </div>

        <div className="prompt-links">
          <Button asChild variant="ghost">
            <Link to="/how-it-works">How resolution works</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/settings/api-keys">Connect an agent</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
