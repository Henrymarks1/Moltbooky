import { Link, createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { createFrontendClient } from "@pipedream/sdk/browser";
import { CheckCircle, Copy, ExternalLink, Link2, Trophy, Trash2, UserRound, XCircle } from "lucide-react";
import { oppositeSide } from "@moltbooky/core/domain/challenge";
import type { Challenge, ChallengeMatch, RequiredApp, ResolutionEvent, ResolutionRun } from "@moltbooky/core/domain/types";
import { CodeBlock, CodeBlockCopyButton } from "../components/ai-elements/code-block";
import { Conversation, ConversationContent, ConversationScrollButton } from "../components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "../components/ai-elements/message";
import { Sandbox, SandboxContent, SandboxHeader, SandboxTabContent, SandboxTabs, SandboxTabsBar, SandboxTabsList, SandboxTabsTrigger } from "../components/ai-elements/sandbox";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, type ToolState } from "../components/ai-elements/tool";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { api, type ChallengeResolverConnection, type PipedreamConnection } from "../lib/api";
import { credits, shortDate } from "../lib/format";
import { setSeoMeta } from "../lib/seo";
import { authChangeEvent, challengeRefreshEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "challenge/$id",
  component: ChallengeDetail
});

type ResolutionNotice = {
  result: "won" | "lost";
  outcome: "YES" | "NO";
  explanation: string;
};

type OutcomeSummary = {
  result: "won" | "lost" | "resolved" | "unresolved" | "pending";
  outcome?: "YES" | "NO" | "UNRESOLVED";
  title: string;
  detailValue: string;
  detailText: string;
  explanation: string;
};

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
  const [resolutionNotice, setResolutionNotice] = useState<ResolutionNotice | null>(null);
  const wasWatchingResolution = useRef(false);
  const shownResolutionNoticeKey = useRef<string | null>(null);
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
    const uniqueNames = Array.from(new Set(["exa", "browser use", "browser-use", "browser", ...resolverConnections.map((connection) => connection.appName).filter(Boolean)]));
    Promise.allSettled([api.listPipedreamApps(), ...uniqueNames.map((name) => api.listPipedreamApps(name))]).then((results) => {
      if (!active) {
        return;
      }
      const apps = results.flatMap((result) => (result.status === "fulfilled" ? result.value.apps : []));
      const icons = Object.fromEntries(apps.filter((app) => app.imgSrc).map((app) => [app.nameSlug, app.imgSrc!]));
      const browserUseApp = apps.find((app) => app.name.toLowerCase() === "browser use" || app.nameSlug === "browser-use" || app.nameSlug === "browser_use");
      setAppIconSrcBySlug((current) => ({
        ...current,
        ...icons,
        ...(browserUseApp?.imgSrc ? { browser_use: browserUseApp.imgSrc } : {})
      }));
    });
    return () => {
      active = false;
    };
  }, [resolverConnections]);

  useEffect(() => {
    if (!challenge || user?.id !== challenge.creatorId) {
      return;
    }

    if (challenge.status === "resolving") {
      wasWatchingResolution.current = true;
      return;
    }

    if (challenge.status !== "provisional_resolved" && challenge.status !== "final_resolved") {
      return;
    }

    const outcome = challenge.provisionalOutcome;
    if (outcome !== "YES" && outcome !== "NO") {
      return;
    }

    const noticeKey = `${challenge.id}:${outcome}:${resolutionRuns[0]?.id ?? "resolved"}`;
    if (!wasWatchingResolution.current || shownResolutionNoticeKey.current === noticeKey) {
      return;
    }

    shownResolutionNoticeKey.current = noticeKey;
    const result = outcome === challenge.creatorSide ? "won" : "lost";
    const explanation =
      resolutionRuns[0]?.aiRationale ||
      [...resolutionEvents].reverse().find((event) => event.kind === "run_finished" && event.body)?.body ||
      `The resolver settled this bet as ${outcome}.`;

    setResolutionNotice({ result, outcome, explanation });

    if (result === "won") {
      void fireWinConfetti();
    }
  }, [
    challenge?.creatorId,
    challenge?.creatorSide,
    challenge?.id,
    challenge?.provisionalOutcome,
    challenge?.status,
    resolutionEvents,
    resolutionRuns,
    user?.id
  ]);

  if (!challenge) {
    return <ChallengeDetailSkeleton />;
  }

  const canDelete = user?.id === challenge.creatorId && challenge.status === "open" && challenge.matchedCents === 0 && matches.length === 0;
  const isCreator = user?.id === challenge.creatorId;
  const isHeadToHead = challenge.kind === "head_to_head";
  const isPendingAcceptance = isHeadToHead && challenge.status === "pending_acceptance";
  const takerSide = oppositeSide(challenge.creatorSide);
  const creatorName = challenge.creatorName?.trim() || challenge.creatorId;
  const agentRunLabel = formatAgentRun(challenge.expiresAt, now);
  const latestRun = resolutionRuns[0] ?? null;
  const outcomeSummary = getOutcomeSummary(challenge, isCreator, latestRun, resolutionEvents);

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
      {resolutionNotice && <ResolutionOutcomeModal notice={resolutionNotice} onClose={() => setResolutionNotice(null)} />}

      <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3 max-[980px]:grid-cols-1">
        <div className="grid min-h-0">
          <AgentChatPanel
            challenge={challenge}
            latestRun={latestRun}
            resolutionEvents={resolutionEvents}
            resolverConnections={resolverConnections}
            iconSrcBySlug={appIconSrcBySlug}
            agentRunLabel={agentRunLabel}
            outcomeSummary={outcomeSummary}
          />
        </div>

        <aside className="grid max-h-full content-start gap-2 overflow-y-auto pr-1">
          <Card>
            <CardHeader className="p-4">
              <CardTitle>Bet details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 px-4 pb-4 pt-0 text-sm">
              {outcomeSummary && <DetailRow label={outcomeSummary.result === "pending" ? "Status" : "Result"} value={outcomeSummary.detailValue} detail={outcomeSummary.detailText} />}
              <DetailRow label="Amount" value={credits(challenge.stakeCents)} detail="Even odds" />
              <DetailRow label="Creator side" value={challenge.creatorSide} detail={`The other side is ${takerSide}`} />
              <DetailRow label="Creator" value={creatorName} detail="Started this bet" icon={<UserRound size={16} />} />
              <DetailRow label="Matched" value={credits(challenge.matchedCents)} detail={`${credits(available)} still open`} />
            </CardContent>
          </Card>

          {isPendingAcceptance && isCreator ? (
            <Card>
              <CardHeader className="p-4">
                <CardTitle>Waiting for your opponent</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 px-4 pb-4 pt-0">
                <p className="text-sm leading-6 text-muted-foreground">
                  {challenge.invitedOpponentEmail ? (
                    <>We emailed the invite to <strong className="text-foreground">{challenge.invitedOpponentEmail}</strong>. They sign in with that email, connect {(challenge.requiredApps ?? []).map((app) => app.appName).join(", ") || "the required accounts"}, and accept — then the resolver compares you both at expiry.</>
                  ) : (
                    <>Send this link to your opponent. They connect the required {(challenge.requiredApps ?? []).map((app) => app.appName).join(", ") || "accounts"} and accept, then the resolver compares you both at expiry.</>
                  )}
                </p>
                <Button variant="outline" type="button" onClick={() => navigator.clipboard.writeText(window.location.href)}>
                  <Copy size={18} /> Copy link
                </Button>
              </CardContent>
            </Card>
          ) : isPendingAcceptance ? (
            user ? (
              <HeadToHeadAcceptPanel challenge={challenge} userEmail={user.email} onAccepted={() => refresh().catch((err: Error) => setMessage(err.message))} />
            ) : (
              <Card>
                <CardHeader className="p-4">
                  <CardTitle>Accept this challenge</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 px-4 pb-4 pt-0">
                  <p className="text-sm leading-6 text-muted-foreground">Sign in to connect your accounts and accept.</p>
                  <Button asChild>
                    <Link to="/login">Sign up to accept</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/login">Log in</Link>
                  </Button>
                </CardContent>
              </Card>
            )
          ) : (
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
                ) : isHeadToHead ? (
                  <p className="text-sm leading-6 text-muted-foreground">This is a head-to-head challenge between the creator and their invited opponent.</p>
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
          )}
        </aside>
      </section>
    </div>
  );
}

function HeadToHeadAcceptPanel(props: { challenge: Challenge; userEmail: string; onAccepted: () => void }) {
  const navigate = useNavigate();
  const requiredApps = props.challenge.requiredApps ?? [];
  const invitedEmail = props.challenge.invitedOpponentEmail?.trim() ?? "";
  const emailMatches = !invitedEmail || invitedEmail.toLowerCase() === props.userEmail.trim().toLowerCase();
  const [connections, setConnections] = useState<PipedreamConnection[]>([]);
  const [stakeCredits, setStakeCredits] = useState(() => String(props.challenge.stakeCents / 100));
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .listPipedreamConnections()
      .then(({ connections: rows }) => {
        if (!cancelled) {
          setConnections(rows);
        }
      })
      .catch(() => {
        // Connections require an authenticated user; surfaced via the connect button otherwise.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectionByAppSlug = useMemo(() => new Map(connections.map((connection) => [connection.appSlug, connection])), [connections]);
  const allConnected = requiredApps.every((app) => connectionByAppSlug.has(app.appSlug));

  async function connectApp(app: RequiredApp) {
    setError("");
    setConnectingApp(app.appSlug);
    try {
      const initialToken = await api.createPipedreamConnectToken();
      const client = createFrontendClient({
        externalUserId: initialToken.externalUserId,
        token: initialToken.token,
        tokenCallback: async () => {
          const freshToken = await api.createPipedreamConnectToken();
          return {
            token: freshToken.token,
            expiresAt: freshToken.expiresAt ? new Date(freshToken.expiresAt) : new Date(Date.now() + 3 * 60 * 60 * 1000),
            connectLinkUrl: freshToken.connectLinkUrl ?? ""
          };
        }
      });

      await client.connectAccount({
        app: app.appSlug,
        onSuccess: ({ id }) => {
          void api
            .savePipedreamConnection({ appSlug: app.appSlug, appName: app.appName, accountId: id, authPropName: app.appSlug })
            .then(({ connection }) => {
              setConnections((rows) => [...rows.filter((item) => item.appSlug !== connection.appSlug), connection]);
            })
            .catch((err) => setError((err as Error).message));
        },
        onError: (err) => setError(err.message),
        onClose: () => setConnectingApp(null)
      });
    } catch (err) {
      const message = (err as Error).message;
      if (message.toLowerCase().includes("sign in")) {
        await navigate({ to: "/login" });
        return;
      }
      setError(message);
      setConnectingApp(null);
    }
  }

  async function accept() {
    setAccepting(true);
    setError("");
    try {
      const opponentConnections = requiredApps
        .map((app) => connectionByAppSlug.get(app.appSlug))
        .filter((connection): connection is PipedreamConnection => Boolean(connection))
        .map((connection) => ({ appSlug: connection.appSlug, connectionId: connection.id }));
      await api.acceptChallenge(props.challenge.id, { opponentConnections, stakeCredits });
      props.onAccepted();
    } catch (err) {
      const message = (err as Error).message;
      if (message.toLowerCase().includes("sign in")) {
        await navigate({ to: "/login" });
        return;
      }
      setError(message);
    } finally {
      setAccepting(false);
    }
  }

  if (!emailMatches) {
    return (
      <Card>
        <CardHeader className="p-4">
          <CardTitle>Wrong account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 px-4 pb-4 pt-0">
          <p className="text-sm leading-6 text-muted-foreground">
            This challenge was sent to <strong className="text-foreground">{invitedEmail}</strong>, but you're signed in as <strong className="text-foreground">{props.userEmail}</strong>. Sign in with the invited email to accept.
          </p>
          <Button type="button" variant="outline" onClick={() => navigate({ to: "/login" })}>Switch account</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="p-4">
        <CardTitle>Accept this challenge</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 pb-4 pt-0">
        <p className="text-sm leading-6 text-muted-foreground">Connect the required accounts and stake to go head-to-head. The resolver reads both of you at expiry.</p>
        <div className="grid gap-2">
          {requiredApps.map((app) => {
            const connected = connectionByAppSlug.get(app.appSlug);
            return (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-card p-2.5" key={app.appSlug}>
                <span className="text-sm font-semibold text-foreground">{app.appName}</span>
                {connected ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><CheckCircle size={15} /> Connected</span>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={() => connectApp(app)} disabled={connectingApp === app.appSlug}>
                    <Link2 size={15} /> {connectingApp === app.appSlug ? "Connecting..." : "Connect"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-muted-foreground">Your stake (credits)</span>
          <Input inputMode="decimal" min="5" max="100" step="1" value={stakeCredits} onChange={(event) => setStakeCredits(event.target.value)} />
        </label>
        {error && <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm leading-6 text-destructive">{error}</p>}
        <Button type="button" onClick={accept} disabled={accepting || !allConnected}>
          {accepting ? "Accepting..." : allConnected ? "Accept challenge" : "Connect required accounts"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ResolutionOutcomeModal(props: { notice: ResolutionNotice; onClose: () => void }) {
  const won = props.notice.result === "won";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="resolution-outcome-title">
      <div className="w-full max-w-lg rounded-lg border bg-card p-5 text-card-foreground shadow-xl">
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${won ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {won ? <Trophy size={20} /> : <XCircle size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Bet resolved {props.notice.outcome}</span>
            <h2 id="resolution-outcome-title" className="mt-1 text-2xl font-semibold tracking-tight">
              {won ? "You won this bet" : "You lost this bet"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {won ? "The resolver outcome matched the side you created." : "The resolver outcome landed on the opposite side of your bet."}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-md border bg-muted/50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {won ? <CheckCircle size={16} /> : <XCircle size={16} />}
            Why
          </div>
          <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{props.notice.explanation}</p>
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={props.onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}

function PromptOutcomeStrip(props: { summary: OutcomeSummary }) {
  const won = props.summary.result === "won";
  const lost = props.summary.result === "lost";
  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${won ? "border-primary/30 bg-primary/10" : lost ? "border-destructive/30 bg-destructive/10" : "bg-muted/50"}`}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${won ? "bg-primary text-primary-foreground" : lost ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground"}`}>
        {won ? <Trophy size={15} /> : lost ? <XCircle size={15} /> : <CheckCircle size={15} />}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <strong className="text-sm font-semibold leading-5">{props.summary.title}</strong>
        {props.summary.outcome && <Badge variant="outline">Outcome {props.summary.outcome}</Badge>}
        <p className="w-full break-words text-xs leading-5 text-muted-foreground">{props.summary.explanation}</p>
      </div>
    </div>
  );
}

async function fireWinConfetti(): Promise<void> {
  const { confetti } = await import("@tsparticles/confetti");
  const count = 180;
  const defaults = {
    disableForReducedMotion: true,
    position: { y: 70 },
    zIndex: 60
  };

  await Promise.all([
    confetti({ ...defaults, count: Math.floor(count * 0.25), spread: 26, startVelocity: 55 }),
    confetti({ ...defaults, count: Math.floor(count * 0.2), spread: 60 }),
    confetti({ ...defaults, count: Math.floor(count * 0.35), spread: 100, decay: 0.91, scalar: 0.8 }),
    confetti({ ...defaults, count: Math.floor(count * 0.1), spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 }),
    confetti({ ...defaults, count: Math.floor(count * 0.1), spread: 120, startVelocity: 45 })
  ]);
}

function getOutcomeSummary(
  challenge: Challenge,
  isCreator: boolean,
  latestRun: ResolutionRun | null,
  events: ResolutionEvent[]
): OutcomeSummary | null {
  if (challenge.status === "resolving") {
    return {
      result: "pending",
      title: "Resolver is checking this bet",
      detailValue: "Resolving",
      detailText: "The agent is gathering evidence now.",
      explanation: "The outcome will appear here when the resolver finishes."
    };
  }

  if (challenge.status !== "provisional_resolved" && challenge.status !== "final_resolved") {
    return null;
  }

  const outcome = challenge.provisionalOutcome ?? latestRun?.proposedOutcome ?? undefined;
  const explanation =
    latestRun?.aiRationale ||
    [...events].reverse().find((event) => event.kind === "run_finished" && event.body)?.body ||
    (outcome ? `The resolver settled this bet as ${outcome}.` : "The resolver finished this bet.");

  if (outcome === "UNRESOLVED" || !outcome) {
    return {
      result: "unresolved",
      outcome: "UNRESOLVED",
      title: "This bet was not resolved",
      detailValue: "Unresolved",
      detailText: "No side won this resolution.",
      explanation
    };
  }

  const creatorWon = outcome === challenge.creatorSide;
  if (isCreator) {
    return {
      result: creatorWon ? "won" : "lost",
      outcome,
      title: creatorWon ? "You won this bet" : "You lost this bet",
      detailValue: creatorWon ? "You won" : "You lost",
      detailText: `Resolved ${outcome}; your side was ${challenge.creatorSide}.`,
      explanation
    };
  }

  return {
    result: "resolved",
    outcome,
    title: `Resolved ${outcome}`,
    detailValue: `Resolved ${outcome}`,
    detailText: `Creator side was ${challenge.creatorSide}.`,
    explanation
  };
}

function AgentChatPanel(props: {
  challenge: Challenge;
  latestRun: ResolutionRun | null;
  resolutionEvents: ResolutionEvent[];
  resolverConnections: ChallengeResolverConnection[];
  iconSrcBySlug: Record<string, string>;
  agentRunLabel: { primary: string; secondary: string };
  outcomeSummary: OutcomeSummary | null;
}) {
  const isWaiting = props.challenge.status === "open" && !props.latestRun;
  const isRunning = props.challenge.status === "resolving";
  const hasNoRun = !isWaiting && !isRunning && !props.latestRun;
  const transcriptItems = buildResolverTranscript(props.resolutionEvents);
  const hasTranscript = transcriptItems.length > 0;

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <CardContent className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto overflow-x-hidden p-4">
        <PromptBubble challenge={props.challenge} connections={props.resolverConnections} iconSrcBySlug={props.iconSrcBySlug} outcomeSummary={props.outcomeSummary} />

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
              <ResolverTranscriptItem isRunning={isRunning} item={item} key={item.id} />
            ))}

            {props.latestRun && props.resolutionEvents.length === 0 && <HistoricalRunMessages latestRun={props.latestRun} resolverConnections={props.resolverConnections} />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </CardContent>
    </Card>
  );
}

function BrowserUseLiveView(props: { isRunning: boolean; liveUrl: string }) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase text-muted-foreground">Browser view</span>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{props.isRunning ? "Read-only live preview" : "Read-only browser session"}</p>
        </div>
        <Badge variant="outline">Read-only</Badge>
      </div>
      <div className="relative h-[260px] overflow-hidden rounded-md border bg-muted sm:h-[320px] xl:h-[360px]">
        <iframe
          allow="autoplay"
          className="h-full w-full pointer-events-none select-none"
          sandbox="allow-scripts allow-same-origin"
          src={props.liveUrl}
          tabIndex={-1}
          title="Browser Use read-only live view"
        />
        <div aria-hidden="true" className="absolute inset-0 cursor-not-allowed" title="This public browser preview is read-only." />
      </div>
    </div>
  );
}

type ResolverTranscriptItem =
  | { id: string; type: "message"; title?: string; body: string }
  | { id: string; type: "tool"; name: string; input: unknown; code?: string; output?: React.ReactNode; errorText?: string; state: ToolState; browserUseLiveUrl?: string };

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

    if (isBrowserUseEvent(event)) {
      if (event.kind === "tool_call" && event.title === "Starting Browser Use") {
        const result = findBrowserUseResult(orderedEvents, index);
        if (result.resultEvent) {
          usedResults.add(result.resultEvent.id);
        }
        stepItems.push({
          id: event.id,
          type: "tool",
          name: "Browser Use",
          input: toolInputFromEvent(event),
          output: result.resultEvent?.body ?? undefined,
          browserUseLiveUrl: result.liveUrl ?? undefined,
          state: result.resultEvent ? "output-available" : "input-available"
        });
      }
      return;
    }

    if (event.kind === "agent_output") {
      stepMessageId ||= event.id;
      stepText += event.body ?? "";
      return;
    }

    if (event.kind === "tool_call") {
      if (event.title.startsWith("Preparing ") || event.title === "Finalizing bet" || shouldHideRequestedToolEvent(event) || isCodeModeFetchEvent(event)) {
        return;
      }

      const result = findToolResult(orderedEvents, index, event, usedResults);
      if (result) {
        usedResults.add(result.id);
      }

      const code = getMetadataString(event, "helper") === "codemode.run" ? event.body ?? undefined : undefined;
      stepItems.push({
        id: event.id,
        type: "tool",
        name: toolTitleFromEvent(event),
        input: code ? {} : toolInputFromEvent(event),
        code,
        output: isToolErrorResult(result) ? undefined : result?.body ?? undefined,
        errorText: isToolErrorResult(result) ? result?.body ?? result?.title : undefined,
        browserUseLiveUrl: result ? getMetadataString(result, "browserUseLiveUrl") ?? undefined : undefined,
        state: result ? (isToolErrorResult(result) ? "output-error" : "output-available") : "input-available"
      });
      return;
    }

    if (event.kind === "tool_result") {
      if (usedResults.has(event.id) || event.title === "executeCode completed" || event.title === "resolveBet completed" || event.title === "Bet finalized" || isCodeModeFetchEvent(event)) {
        return;
      }
      stepItems.push({
        id: event.id,
        type: "tool",
        name: event.title,
        input: {},
        output: isToolErrorResult(event) ? undefined : event.body ?? undefined,
        errorText: isToolErrorResult(event) ? event.body ?? event.title : undefined,
        browserUseLiveUrl: getMetadataString(event, "browserUseLiveUrl") ?? undefined,
        state: isToolErrorResult(event) ? "output-error" : "output-available"
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

function isCodeModeFetchEvent(event: ResolutionEvent): boolean {
  return getMetadataString(event, "helper") === "global.fetch";
}

function shouldHideRequestedToolEvent(event: ResolutionEvent): boolean {
  if (!event.title.startsWith("Requested ")) {
    return false;
  }
  const toolName = getMetadataString(event, "toolName");
  if (toolName === "executeCode") {
    return true;
  }
  return !["executeCode", "webSearch", "resolveBet"].includes(toolName ?? "");
}

function isToolErrorResult(event: ResolutionEvent | undefined): boolean {
  if (!event) {
    return false;
  }
  if (event.kind === "error" || event.title.toLowerCase().includes("failed")) {
    return true;
  }
  const metadata = event.metadata;
  return !!(metadata && typeof metadata === "object" && "error" in metadata);
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
    if (event.title === "executeCode completed" || event.title === "Bet finalized") {
      continue;
    }

    const resultHelper = getMetadataString(event, "helper");
    const resultToolName = getMetadataString(event, "toolName");
    if (callHelper) {
      if (callHelper === resultHelper) {
        return event;
      }
      continue;
    }
    if (callToolName && callToolName === resultToolName) {
      return event;
    }
  }
  return undefined;
}

function findBrowserUseResult(events: ResolutionEvent[], startIndex: number): { liveUrl: string | null; resultEvent: ResolutionEvent | null } {
  let liveUrl: string | null = null;
  let resultEvent: ResolutionEvent | null = null;

  for (const event of events.slice(startIndex + 1)) {
    if (event.kind === "tool_call" && event.title === "Starting Browser Use") {
      break;
    }
    if (!isBrowserUseEvent(event)) {
      continue;
    }

    liveUrl ||= getMetadataString(event, "browserUseLiveUrl");
    if (event.kind === "tool_result" && (event.title === "useBrowser completed" || event.title === "browserUse completed" || event.title === "Browser Use completed")) {
      resultEvent = event;
    }
  }

  return { liveUrl, resultEvent };
}

function isBrowserUseEvent(event: ResolutionEvent): boolean {
  const toolName = getMetadataString(event, "toolName");
  return toolName === "useBrowser" || toolName === "browserUse" || event.title.startsWith("Browser Use");
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
    try {
      return JSON.parse(event.body) as unknown;
    } catch {
      // Fall through to the plain text shape below.
    }
  }
  if (event.body) {
    return { input: event.body };
  }
  return {};
}

function toolTitleFromEvent(event: ResolutionEvent): string {
  const toolName = getMetadataString(event, "toolName");
  if (event.title === "Requested executeCode" || toolName === "executeCode") {
    return "Generated TypeScript";
  }
  if (event.title === "Running generated TypeScript") {
    return "Generated TypeScript";
  }
  if (event.title === "Requested webSearch" || toolName === "webSearch") {
    return "Web search";
  }
  if (event.title === "Requested browserUse" || toolName === "browserUse" || toolName === "useBrowser") {
    return "Browser Use";
  }
  if (event.title === "Requested resolveBet" || toolName === "resolveBet") {
    return "Final resolution";
  }
  return event.title;
}

function GeneratedCodeSandbox(props: { item: Extract<ResolverTranscriptItem, { type: "tool" }> }) {
  const output = typeof props.item.output === "string" ? props.item.output : undefined;
  const hasOutputTab = !!(output || props.item.errorText);

  return (
    <Sandbox className="mb-0 max-w-full bg-background" defaultOpen={props.item.state === "input-available" || props.item.state === "output-error"}>
      <SandboxHeader state={props.item.state} title={props.item.name} />
      <SandboxContent>
        <SandboxTabs defaultValue="code">
          <SandboxTabsBar>
            <SandboxTabsList>
              <SandboxTabsTrigger value="code">Code</SandboxTabsTrigger>
              {hasOutputTab && <SandboxTabsTrigger value="output">Output</SandboxTabsTrigger>}
            </SandboxTabsList>
          </SandboxTabsBar>
          <SandboxTabContent value="code">
            <CodeBlock className="rounded-none border-0" code={props.item.code ?? ""} language="typescript">
              <CodeBlockCopyButton />
            </CodeBlock>
          </SandboxTabContent>
          {hasOutputTab && (
            <SandboxTabContent value="output">
              {props.item.errorText ? (
                <pre className="overflow-x-auto bg-destructive/10 p-4 text-xs leading-5 text-destructive">{props.item.errorText}</pre>
              ) : (
                <pre className="overflow-x-auto p-4 text-xs leading-5">{output}</pre>
              )}
            </SandboxTabContent>
          )}
        </SandboxTabs>
      </SandboxContent>
    </Sandbox>
  );
}

function ResolverTranscriptItem(props: { isRunning: boolean; item: ResolverTranscriptItem }) {
  if (props.item.type === "tool") {
    if (props.item.code) {
      return <GeneratedCodeSandbox item={props.item} />;
    }
    return (
      <Tool defaultOpen={props.item.state === "input-available" || props.item.state === "output-error"} className="max-w-full bg-background">
        <ToolHeader title={props.item.name} type="tool-executeCode" state={props.item.state} />
        <ToolContent>
          <ToolInput input={props.item.input} />
          {props.item.browserUseLiveUrl && <BrowserUseLiveView isRunning={props.isRunning} liveUrl={props.item.browserUseLiveUrl} />}
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
        <ToolHeader title="Web search" type="tool-executeCode" state="output-available" />
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

function PromptBubble(props: { challenge: Challenge; connections: ChallengeResolverConnection[]; iconSrcBySlug: Record<string, string>; outcomeSummary: OutcomeSummary | null }) {
  const summary = props.outcomeSummary && props.outcomeSummary.result !== "pending" ? props.outcomeSummary : null;
  return (
    <div className="sticky top-0 z-10 grid gap-2.5 rounded-lg border bg-background p-3 shadow-sm">
      {summary && <PromptOutcomeStrip summary={summary} />}
      <span className="text-xs font-semibold uppercase text-muted-foreground">Prompt</span>
      <h1 className="text-xl font-bold leading-tight tracking-tight">{props.challenge.claim}</h1>
      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm leading-5 text-muted-foreground">
        <strong className="mb-0.5 block text-xs uppercase text-muted-foreground">Resolution criteria</strong>
        {props.challenge.resolutionCriteria}
      </div>
      <div className="flex flex-wrap gap-2">
        <ToolChip label="Web search" iconSrc={props.iconSrcBySlug.exa} fallback="WS" />
        <ToolChip label="Browser Use" iconSrc={props.iconSrcBySlug.browser_use ?? props.iconSrcBySlug["browser-use"] ?? props.iconSrcBySlug.browseruse} fallback="BU" />
        {props.connections.map((connection) => (
          <ToolChip key={connection.id} label={connection.appName} iconSrc={props.iconSrcBySlug[connection.appSlug]} fallback={connection.appName.slice(0, 2).toUpperCase()} />
        ))}
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
