import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, Copy, ExternalLink, Trash2, UserRound } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch, ResolutionEvent, ResolutionRun } from "@moltbooky/core/domain/types";
import { Conversation, ConversationContent, ConversationScrollButton } from "../components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "../components/ai-elements/message";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, type ToolState } from "../components/ai-elements/tool";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api, type ChallengeResolverConnection } from "../lib/api";
import { credits, shortDate } from "../lib/format";
import { getLatestBrowserUseLiveUrl } from "../lib/resolutionEvents";
import { setSeoMeta } from "../lib/seo";
import { authChangeEvent, challengeRefreshEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "challenge/$id",
  component: ChallengeDetail
});

function ChallengeDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [matches, setMatches] = useState<ChallengeMatch[]>([]);
  const [resolutionEvents, setResolutionEvents] = useState<ResolutionEvent[]>([]);
  const [resolutionRuns, setResolutionRuns] = useState<ResolutionRun[]>([]);
  const [available, setAvailable] = useState(0);
  const [message, setMessage] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [resolverConnections, setResolverConnections] = useState<ChallengeResolverConnection[]>([]);
  const [appIconSrcBySlug, setAppIconSrcBySlug] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState(false);
  const [matchCredits, setMatchCredits] = useState("5");
  const [matching, setMatching] = useState(false);
  const [now, setNow] = useState(Date.now());
  const resolverChatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/challenges/${encodeURIComponent(id)}/resolution-stream`,
        credentials: "include"
      }),
    [id]
  );
  const resolverChat = useChat({
    id: `resolver-${id}`,
    transport: resolverChatTransport,
    onData: (dataPart) => {
      if (dataPart.type !== "data-resolution-event") {
        return;
      }
      const event = dataPart.data as ResolutionEvent;
      setResolutionEvents((events) => (events.some((item) => item.id === event.id) ? events : [...events, event]));
    },
    onFinish: () => {
      refresh().catch((err: Error) => setMessage(err.message));
    },
    onError: (err) => {
      setMessage(err.message);
    }
  });

  async function refresh() {
    const data = await api.getChallenge(id);
    setChallenge(data.challenge);
    setMatches(data.matches);
    setResolutionEvents(data.resolutionEvents);
    setResolutionRuns(data.resolutionRuns);
    setAvailable(data.availableToMatchCents);
    setResolverConnections(data.resolverConnections ?? []);
  }

  useEffect(() => {
    refresh().catch((err: Error) => setMessage(err.message));
  }, [id]);

  useEffect(() => {
    void resolverChat.sendMessage({ text: "Subscribe to resolver events." });
  }, [id, resolverChat.sendMessage]);

  useEffect(() => {
    function refreshChallenge(event: Event) {
      if (event instanceof CustomEvent && event.detail?.challengeId === id) {
        const expiresAt = typeof event.detail.expiresAt === "string" ? event.detail.expiresAt : new Date().toISOString();
        setChallenge((current) => (current ? { ...current, expiresAt, status: event.detail.status ?? current.status } : current));
        setNow(Date.now());
        refresh().catch((err: Error) => setMessage(err.message));
        return;
      }
      refresh().catch((err: Error) => setMessage(err.message));
    }

    window.addEventListener(challengeRefreshEvent, refreshChallenge);
    return () => window.removeEventListener(challengeRefreshEvent, refreshChallenge);
  }, [id]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!challenge) {
      return;
    }

    const expiresAt = new Date(challenge.expiresAt).getTime();
    const shouldPoll = challenge.status === "resolving" || (challenge.status === "open" && expiresAt <= now);
    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      refresh().catch((err: Error) => setMessage(err.message));
    }, challenge.status === "resolving" ? 1200 : 8000);
    return () => window.clearInterval(interval);
  }, [challenge?.expiresAt, challenge?.status, id, challenge ? new Date(challenge.expiresAt).getTime() <= now : false]);

  useEffect(() => {
    if (!challenge) {
      return;
    }

    setSeoMeta({
      title: `${challenge.claim.slice(0, 82)} | Moltbooky`,
      description: `${credits(challenge.stakeCents)} ${challenge.creatorSide} at 1:1 odds. ${credits(available)} still available to match before ${shortDate(challenge.expiresAt)}.`,
      path: `/challenge/${challenge.id}`,
      image: `${window.location.origin}/share/challenge/${encodeURIComponent(challenge.id)}`
    });
  }, [available, challenge]);

  useEffect(() => {
    let active = true;

    async function refreshAuth() {
      const currentUser = await getCurrentUser();
      if (active) {
        setUser(currentUser);
      }
    }

    void refreshAuth();
    window.addEventListener(authChangeEvent, refreshAuth);
    window.addEventListener("focus", refreshAuth);

    return () => {
      active = false;
      window.removeEventListener(authChangeEvent, refreshAuth);
      window.removeEventListener("focus", refreshAuth);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const uniqueNames = Array.from(new Set(["exa", ...resolverConnections.map((connection) => connection.appName).filter(Boolean)]));
    Promise.allSettled([api.listPipedreamApps(), ...uniqueNames.map((name) => api.listPipedreamApps(name))]).then((results) => {
      if (!active) {
        return;
      }
      const icons = Object.fromEntries(
        results
          .flatMap((result) => (result.status === "fulfilled" ? result.value.apps : []))
          .filter((app) => app.imgSrc)
          .map((app) => [app.nameSlug, app.imgSrc!])
      );
      setAppIconSrcBySlug((current) => ({ ...current, ...icons }));
    });
    return () => {
      active = false;
    };
  }, [resolverConnections]);

  if (!challenge) {
    return <ChallengeDetailSkeleton />;
  }

  const canDelete = user?.id === challenge.creatorId && challenge.matchedCents === 0 && matches.length === 0;
  const isCreator = user?.id === challenge.creatorId;
  const takerSide = oppositeSide(challenge.creatorSide);
  const creatorName = challenge.creatorName?.trim() || challenge.creatorId;
  const agentRunLabel = formatAgentRun(challenge.expiresAt, now);
  const latestRun = resolutionRuns[0] ?? null;

  async function deleteChallenge() {
    if (!challenge || !window.confirm("Delete this unmatched bet and return the locked credits?")) {
      return;
    }
    setDeleting(true);
    setMessage("");
    try {
      await api.deleteChallenge(challenge.id);
      await navigate({ to: "/my-bets" });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bet could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function matchBet() {
    if (!challenge) {
      return;
    }
    setMatching(true);
    setMessage("");
    try {
      await api.matchChallenge(challenge.id, matchCredits);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Bet could not be matched.");
    } finally {
      setMatching(false);
    }
  }

  return (
    <div className="mx-auto grid h-[calc(100vh-112px)] max-w-7xl gap-3 overflow-hidden">
      {message && <div className="rounded-lg border bg-card p-4 text-sm text-card-foreground">{message}</div>}

      <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3 max-[980px]:grid-cols-1">
        <div className="grid min-h-0">
          <AgentChatPanel
            challenge={challenge}
            latestRun={latestRun}
            resolutionEvents={resolutionEvents}
            resolverConnections={resolverConnections}
            iconSrcBySlug={appIconSrcBySlug}
            agentRunLabel={agentRunLabel}
          />
        </div>

        <aside className="grid max-h-full content-start gap-2 overflow-y-auto pr-1">
          <Card>
            <CardHeader className="p-4">
              <CardTitle>Bet details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 px-4 pb-4 pt-0 text-sm">
              <DetailRow label="Amount" value={credits(challenge.stakeCents)} detail="Even odds" />
              <DetailRow label="Creator side" value={challenge.creatorSide} detail={`The other side is ${takerSide}`} />
              <DetailRow label="Creator" value={creatorName} detail="Started this bet" icon={<UserRound size={16} />} />
              <DetailRow label="Matched" value={credits(challenge.matchedCents)} detail={`${credits(available)} still open`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle>{isCreator ? "Share this bet" : "Take the other side"}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 pb-4 pt-0">
              {isCreator ? (
                <>
                  <p className="text-sm leading-6 text-muted-foreground">You cannot match your own bet. Send the link to someone who wants the opposite side.</p>
                  <Button variant="outline" type="button" onClick={() => navigator.clipboard.writeText(window.location.href)}>
                    <Copy size={18} /> Copy link
                  </Button>
                  {canDelete && (
                    <Button type="button" variant="destructive" onClick={deleteChallenge} disabled={deleting}>
                      <Trash2 size={18} /> {deleting ? "Deleting..." : "Delete bet"}
                    </Button>
                  )}
                </>
              ) : user ? (
                <>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-muted-foreground">Credits</span>
                    <Input
                      inputMode="decimal"
                      min="0.01"
                      max={String(available / 100)}
                      step="0.01"
                      value={matchCredits}
                      onChange={(event) => setMatchCredits(event.target.value)}
                    />
                  </label>
                  <Button type="button" onClick={matchBet} disabled={matching || available <= 0}>
                    {matching ? "Matching..." : available > 0 ? "Match bet" : "Fully matched"}
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild>
                    <Link to="/login">Sign up to match</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/login">Log in</Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function AgentChatPanel(props: {
  challenge: Challenge;
  latestRun: ResolutionRun | null;
  resolutionEvents: ResolutionEvent[];
  resolverConnections: ChallengeResolverConnection[];
  iconSrcBySlug: Record<string, string>;
  agentRunLabel: { primary: string; secondary: string };
}) {
  const isWaiting = props.challenge.status === "open" && !props.latestRun;
  const isRunning = props.challenge.status === "resolving";
  const hasNoRun = !isWaiting && !isRunning && !props.latestRun;
  const transcriptItems = buildResolverTranscript(props.resolutionEvents);
  const hasTranscript = transcriptItems.length > 0;
  const browserUseLiveUrl = getLatestBrowserUseLiveUrl(props.resolutionEvents);

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <CardHeader className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Resolver chat</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Tool usage, evidence, and the resolution summary appear here.</p>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground"><Bot size={16} /></span>
        </div>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 pb-4 pt-0">
        <PromptBubble challenge={props.challenge} connections={props.resolverConnections} iconSrcBySlug={props.iconSrcBySlug} />
        {(browserUseLiveUrl || isRunning) && <BrowserUseLiveView isRunning={isRunning} liveUrl={browserUseLiveUrl} />}

        <Conversation className="min-h-0">
          <ConversationContent className="gap-3 p-0">
            {!hasTranscript && (isWaiting || isRunning) && <ResolverCountdownMessage agentRunLabel={props.agentRunLabel} isRunning={isRunning} />}

            {hasNoRun && (
              <Message from="assistant">
                <MessageContent className="rounded-lg border bg-card p-3">
                  <MessageResponse>{`This bet is ${props.challenge.status.replaceAll("_", " ")}. No resolver run has been recorded yet.`}</MessageResponse>
                </MessageContent>
              </Message>
            )}

            {transcriptItems.map((item) => (
              <ResolverTranscriptItem item={item} key={item.id} />
            ))}

            {props.latestRun && props.resolutionEvents.length === 0 && <HistoricalRunMessages latestRun={props.latestRun} resolverConnections={props.resolverConnections} />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </CardContent>
    </Card>
  );
}

function BrowserUseLiveView(props: { isRunning: boolean; liveUrl: string | null }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase text-muted-foreground">Browser view</span>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {props.liveUrl ? "Live Browser Use session" : props.isRunning ? "Waiting for Browser Use to start" : "Browser session ended"}
          </p>
        </div>
        {props.liveUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={props.liveUrl} rel="noreferrer" target="_blank">
              <ExternalLink size={14} />
              Open
            </a>
          </Button>
        )}
      </div>
      {props.liveUrl ? (
        <iframe
          allow="autoplay"
          className="aspect-video w-full rounded-md border bg-muted"
          src={props.liveUrl}
          title="Browser Use live view"
        />
      ) : (
        <div className="grid aspect-video place-items-center rounded-md border bg-muted px-4 text-center text-sm leading-6 text-muted-foreground">
          The live browser will appear here if the resolver needs Browser Use for this challenge.
        </div>
      )}
    </div>
  );
}

type ResolverTranscriptItem =
  | { id: string; type: "message"; title?: string; body: string }
  | { id: string; type: "tool"; name: string; input: unknown; output?: React.ReactNode; errorText?: string; state: ToolState };

function buildResolverTranscript(events: ResolutionEvent[]): ResolverTranscriptItem[] {
  const orderedEvents = [...events].sort((left, right) => getEventSequence(left) - getEventSequence(right));
  const items: ResolverTranscriptItem[] = [];
  const usedResults = new Set<string>();
  let stepText = "";
  let stepMessageId = "";
  let stepItems: ResolverTranscriptItem[] = [];

  function flushStep() {
    const body = normalizeAgentText(stepText);
    if (body) {
      items.push({ id: stepMessageId || `agent-output-${items.length}`, type: "message", body });
    }
    items.push(...stepItems);
    stepText = "";
    stepMessageId = "";
    stepItems = [];
  }

  orderedEvents.forEach((event, index) => {
    if (event.kind === "run_started") {
      return;
    }

    if (event.kind === "model_step") {
      if (event.title === "Model step started") {
        flushStep();
      }
      return;
    }

    if (event.kind === "agent_output") {
      stepMessageId ||= event.id;
      stepText += event.body ?? "";
      return;
    }

    if (event.kind === "tool_call") {
      if (event.title.startsWith("Preparing ") || event.title.startsWith("Requested ")) {
        return;
      }

      const result = findToolResult(orderedEvents, index, event, usedResults);
      if (result) {
        usedResults.add(result.id);
      }

      stepItems.push({
        id: event.id,
        type: "tool",
        name: event.title,
        input: toolInputFromEvent(event),
        output: result?.body ?? undefined,
        state: result ? "output-available" : "input-available"
      });
      return;
    }

    if (event.kind === "tool_result") {
      if (usedResults.has(event.id) || event.title === "executeCode completed" || event.title === "resolveBet completed") {
        return;
      }
      stepItems.push({
        id: event.id,
        type: "tool",
        name: event.title,
        input: {},
        output: event.body ?? undefined,
        state: "output-available"
      });
      return;
    }

    if (event.kind === "error") {
      flushStep();
      items.push({ id: event.id, type: "message", title: event.title, body: event.body ?? "" });
      return;
    }

    if (event.kind === "run_finished" && event.body) {
      flushStep();
      items.push({ id: event.id, type: "message", title: event.title, body: event.body });
    }
  });

  flushStep();

  return items;
}

function getEventSequence(event: ResolutionEvent): number {
  const metadata = event.metadata;
  if (metadata && typeof metadata === "object" && "sequence" in metadata) {
    const sequence = (metadata as Record<string, unknown>).sequence;
    if (typeof sequence === "number") {
      return sequence;
    }
  }
  return new Date(event.createdAt).getTime();
}

function normalizeAgentText(text: string): string {
  return text.replace(/([.!?]["'”’)]?)(?=\S)/g, "$1 ").trim();
}

function findToolResult(events: ResolutionEvent[], startIndex: number, call: ResolutionEvent, usedResults: Set<string>): ResolutionEvent | undefined {
  const callHelper = getMetadataString(call, "helper");
  const callToolName = getMetadataString(call, "toolName");

  for (const event of events.slice(startIndex + 1)) {
    if (event.kind !== "tool_result" || usedResults.has(event.id)) {
      continue;
    }
    if (event.title === "executeCode completed") {
      continue;
    }

    const resultHelper = getMetadataString(event, "helper");
    const resultToolName = getMetadataString(event, "toolName");
    if ((callHelper && callHelper === resultHelper) || (callToolName && callToolName === resultToolName)) {
      return event;
    }
  }
  return undefined;
}

function getMetadataString(event: ResolutionEvent, key: string): string | null {
  const metadata = event.metadata;
  if (!metadata || typeof metadata !== "object" || !(key in metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function toolInputFromEvent(event: ResolutionEvent): unknown {
  const helper = getMetadataString(event, "helper");
  if (helper === "codemode.exaSearch" && event.body) {
    return { query: event.body };
  }
  if (event.body) {
    return { input: event.body };
  }
  return {};
}

function ResolverTranscriptItem(props: { item: ResolverTranscriptItem }) {
  if (props.item.type === "tool") {
    return (
      <Tool defaultOpen={props.item.state === "input-available" || props.item.state === "output-error"} className="max-w-full bg-background">
        <ToolHeader title={props.item.name} type="tool-executeCode" state={props.item.state} />
        <ToolContent>
          <ToolInput input={props.item.input} />
          <ToolOutput output={props.item.output} errorText={props.item.errorText} />
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Message from="assistant">
      <MessageContent className="rounded-lg border bg-card p-3">
        {props.item.title && <span className="text-xs font-semibold uppercase text-muted-foreground">{props.item.title}</span>}
        <MessageResponse>{props.item.body}</MessageResponse>
      </MessageContent>
    </Message>
  );
}

function ResolverCountdownMessage(props: { agentRunLabel: { primary: string; secondary: string }; isRunning: boolean }) {
  return (
    <Message from="assistant">
      <MessageContent className="rounded-lg border bg-card p-3">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{props.isRunning ? "Resolver starting" : "Resolver scheduled"}</span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <strong className="text-2xl font-semibold tracking-tight">{props.isRunning ? "Starting now" : props.agentRunLabel.primary}</strong>
          <span className="text-sm font-medium text-muted-foreground">{props.agentRunLabel.secondary}</span>
        </div>
      </MessageContent>
    </Message>
  );
}

function HistoricalRunMessages(props: { latestRun: ResolutionRun; resolverConnections: ChallengeResolverConnection[] }) {
  return (
    <>
      <Tool defaultOpen={false} className="max-w-full bg-background">
        <ToolHeader title="Exa web search" type="tool-executeCode" state="output-available" />
        <ToolContent>
          <ToolInput input={{ query: props.latestRun.exaQuery }} />
        </ToolContent>
      </Tool>
      {props.resolverConnections.map((connection) => (
        <Tool defaultOpen={false} className="max-w-full bg-background" key={connection.id}>
          <ToolHeader title={connection.appName} type="tool-executeCode" state="output-available" />
          <ToolContent>
            <ToolInput input={{ source: "Private account evidence source available to the resolver." }} />
          </ToolContent>
        </Tool>
      ))}
      <Message from="assistant">
        <MessageContent className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Outcome {props.latestRun.proposedOutcome}</Badge>
            <Badge variant="outline">{Math.round(props.latestRun.confidence * 100)}% confidence</Badge>
          </div>
          <MessageResponse>{props.latestRun.aiRationale}</MessageResponse>
          {props.latestRun.sourceUrls.length > 0 && (
            <div className="mt-3 grid gap-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Sources</span>
              {props.latestRun.sourceUrls.map((url) => (
                <a className="inline-flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium text-foreground no-underline hover:bg-muted" href={url} key={url} rel="noreferrer" target="_blank">
                  <ExternalLink size={14} />
                  <span className="truncate">{url}</span>
                </a>
              ))}
            </div>
          )}
        </MessageContent>
      </Message>
    </>
  );
}

function PromptBubble(props: { challenge: Challenge; connections: ChallengeResolverConnection[]; iconSrcBySlug: Record<string, string> }) {
  return (
    <div className="sticky top-0 z-10 grid gap-3 rounded-lg border bg-background p-3 shadow-sm">
      <span className="text-xs font-semibold uppercase text-muted-foreground">Prompt</span>
      <h1 className="text-2xl font-bold leading-tight tracking-tight max-[720px]:text-xl">{props.challenge.claim}</h1>
      <div className="rounded-md bg-muted/50 p-3 text-sm leading-5 text-muted-foreground">
        <strong className="mb-1 block text-xs uppercase text-muted-foreground">Resolution criteria</strong>
        {props.challenge.resolutionCriteria}
      </div>
      <div className="mt-1 border-t pt-3">
        <span className="mb-2 block text-sm font-semibold text-foreground">Selected tools</span>
        <div className="flex flex-wrap gap-2">
          <ToolChip label="Exa web search" iconSrc={props.iconSrcBySlug.exa} fallback="EX" />
          {props.connections.map((connection) => (
            <ToolChip key={connection.id} label={connection.appName} iconSrc={props.iconSrcBySlug[connection.appSlug]} fallback={connection.appName.slice(0, 2).toUpperCase()} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolChip(props: { fallback: string; iconSrc?: string; label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full border bg-background px-2.5 text-xs font-semibold text-foreground">
      <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-[9px] font-black text-muted-foreground [&_img]:h-4 [&_img]:w-4 [&_img]:object-contain">
        {props.iconSrc ? <img src={props.iconSrc} alt="" /> : props.fallback}
      </span>
      <span>{props.label}</span>
    </span>
  );
}

function DetailRow(props: { detail?: string; icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0">
      <div className="grid gap-1">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</span>
        <strong className="text-sm font-semibold text-foreground">{props.value}</strong>
        {props.detail && <small className="text-xs font-medium leading-5 text-muted-foreground">{props.detail}</small>}
      </div>
      {props.icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">{props.icon}</span>}
    </div>
  );
}

function formatAgentRun(expiresAt: string, now: number): { primary: string; secondary: string } {
  const runAt = new Date(expiresAt);
  const msUntilRun = runAt.getTime() - now;
  if (msUntilRun <= 0) {
    return { primary: shortDate(expiresAt), secondary: "Runs as soon as the resolver picks it up" };
  }
  return { primary: formatCountdown(msUntilRun), secondary: `Runs ${shortDate(expiresAt)}` };
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function ChallengeDetailSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="grid gap-5 rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-10 w-full max-w-[760px]" />
        <Skeleton className="h-5 w-full max-w-[640px]" />
      </header>
      <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-[880px]:grid-cols-1">
        <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
          {Array.from({ length: 5 }).map((_, index) => (
          <div className="rounded-lg border bg-card p-4" key={index}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-44 w-full" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
