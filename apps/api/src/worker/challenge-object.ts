import { oppositeSide, validateMatchAmount } from "@moltbooky/core/domain/challenge";
import type { Challenge, ResolutionEvent, ResolutionOutcome } from "@moltbooky/core/domain/types";
import { challengeMatches, challenges, createDb, eq, resolutionEvents } from "@moltbooky/db";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { getChallenge, json, lockFunds, newId } from "./db";

type ChallengeObjectState = {
  challenge: Challenge;
  currentRunId: string | null;
  status: Challenge["status"];
  scheduledRunAt: string | null;
  lastScheduledSequence: number;
  nextSequence: number;
  updatedAt: string;
};

type StoredResolutionEvent = ResolutionEvent & {
  sequence: number;
};

function resolverBaseUrl(env: Env): string {
  return (env.RESOLVER_URL?.trim() || "http://localhost:8788").replace(/\/+$/, "");
}

function apiInternalBaseUrl(env: Env): string {
  return (env.API_INTERNAL_URL?.trim() || env.BETTER_AUTH_URL?.trim() || "http://localhost:8787").replace(/\/+$/, "");
}

function parseIsoDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeEvent(event: StoredResolutionEvent): ResolutionEvent {
  return {
    id: event.id,
    challengeId: event.challengeId,
    runId: event.runId,
    kind: event.kind,
    title: event.title,
    body: event.body,
    metadata: {
      ...(event.metadata ?? {}),
      sequence: event.sequence
    },
    createdAt: event.createdAt
  };
}

export class ChallengeObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/initialize") {
      const body = (await request.json()) as { challenge: Challenge };
      await this.initialize(body.challenge);
      return json({ ok: true, state: await this.readState() });
    }

    if (request.method === "POST" && url.pathname === "/schedule-resolution") {
      const body = (await request.json()) as { challengeId: string; runAt?: string };
      const runAt = body.runAt ? parseIsoDate(body.runAt) : new Date();
      if (!runAt) {
        return json({ error: "Invalid resolver alarm time." }, { status: 400 });
      }

      const objectState = await this.ensureInitialized(body.challengeId);
      const updatedChallenge = { ...objectState.challenge, expiresAt: runAt.toISOString(), status: "open" as const };
      await this.writeState({
        ...objectState,
        challenge: updatedChallenge,
        currentRunId: null,
        status: "open",
        scheduledRunAt: runAt.toISOString(),
        updatedAt: new Date().toISOString()
      });
      await this.state.storage.setAlarm(runAt);
      const event = await this.appendEvent({
        challengeId: body.challengeId,
        runId: null,
        kind: "run_started",
        title: "Resolver alarm scheduled",
        body: `The resolver alarm will fire at ${runAt.toISOString()}.`,
        metadata: { scheduledRunAt: runAt.toISOString() }
      });
      await this.markLastScheduledSequence(event.sequence);
      return json({ ok: true, challengeId: body.challengeId, runAt: runAt.toISOString(), event: serializeEvent(event) });
    }

    if (request.method === "POST" && url.pathname === "/match") {
      return this.match(request);
    }

    if (request.method === "POST" && url.pathname === "/resolver-event") {
      if (!this.isInternalRequest(request)) {
        return json({ error: "Resolver event access is not allowed." }, { status: 403 });
      }
      const body = (await request.json()) as Omit<ResolutionEvent, "id" | "createdAt"> & { id?: string; createdAt?: string };
      const event = await this.appendEvent(body);
      return json({ ok: true, event: serializeEvent(event), state: await this.readState() });
    }

    if (request.method === "GET" && url.pathname === "/snapshot") {
      const challengeId = url.searchParams.get("challengeId");
      if (challengeId) {
        await this.ensureInitialized(challengeId);
      }
      return json(await this.snapshot());
    }

    if (request.method === "POST" && url.pathname === "/stream") {
      const body = (await request.json().catch(() => ({}))) as { challengeId?: string };
      if (body.challengeId) {
        await this.ensureInitialized(body.challengeId);
      }
      return this.stream(request);
    }

    return json({ error: "Not found." }, { status: 404 });
  }

  async alarm(): Promise<void> {
    const objectState = await this.readState();
    if (!objectState) {
      return;
    }
    if (objectState.status !== "open") {
      return;
    }

    const runId = newId("res");
    const now = new Date().toISOString();
    await this.writeState({
      ...objectState,
      currentRunId: runId,
      status: "resolving",
      challenge: { ...objectState.challenge, status: "resolving" },
      updatedAt: now
    });

    await this.appendEvent({
      challengeId: objectState.challenge.id,
      runId,
      kind: "run_started",
      title: "Resolver alarm fired",
      body: "The Durable Object alarm fired and is starting the resolver worker."
    });

    const token = this.env.RESOLVER_TEST_TOKEN?.trim();
    if (!token) {
      await this.appendEvent({
        challengeId: objectState.challenge.id,
        runId,
        kind: "error",
        title: "Resolver token missing",
        body: "RESOLVER_TEST_TOKEN is required for the Durable Object to start the resolver worker."
      });
      return;
    }

    const response = await fetch(`${resolverBaseUrl(this.env)}/resolve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        challengeId: objectState.challenge.id,
        runId,
        challenge: objectState.challenge,
        eventCallbackUrl: `${apiInternalBaseUrl(this.env)}/api/internal/challenges/${encodeURIComponent(objectState.challenge.id)}/resolver-events`,
        finalizeCallbackUrl: `${apiInternalBaseUrl(this.env)}/api/internal/challenges/${encodeURIComponent(objectState.challenge.id)}/finalize-resolution`,
        eventCallbackToken: token
      })
    });

    if (!response.ok) {
      await this.appendEvent({
        challengeId: objectState.challenge.id,
        runId,
        kind: "error",
        title: "Resolver worker failed",
        body: `Resolver returned status ${response.status}.`
      });
      const retryAt = Date.now() + 10_000;
      await this.state.storage.setAlarm(retryAt);
      throw new Error(`Resolver alarm failed with status ${response.status}. Retrying at ${new Date(retryAt).toISOString()}.`);
    }

    const body = (await response.json().catch(() => ({}))) as {
      finalized?: boolean;
      result?: {
        outcome?: ResolutionOutcome;
        shortRationale?: string;
        confidence?: number;
        sourceUrls?: string[];
      };
    };
    if (!body.finalized) {
      await this.appendEvent({
        challengeId: objectState.challenge.id,
        runId,
        kind: "run_finished",
        title: "Resolver did not finalize",
        body: body.result?.shortRationale ?? "The resolver returned without finalizing this bet.",
        metadata: {
          finalized: false,
          outcome: body.result?.outcome ?? null,
          confidence: body.result?.confidence ?? null,
          sourceUrls: body.result?.sourceUrls ?? []
        }
      });

      const refreshedChallenge = await getChallenge(this.env, objectState.challenge.id);
      const latestState = (await this.readState()) ?? objectState;
      await this.writeState({
        ...latestState,
        status: refreshedChallenge?.status ?? objectState.status,
        challenge: refreshedChallenge ?? latestState.challenge,
        updatedAt: new Date().toISOString()
      });
      return;
    }

    const resultStatus: Challenge["status"] = body.result?.outcome === "UNRESOLVED" ? "voided" : "final_resolved";
    const latestState = (await this.readState()) ?? objectState;
    await this.writeState({
      ...latestState,
      status: resultStatus,
      challenge: {
        ...latestState.challenge,
        status: resultStatus,
        provisionalOutcome: body.result?.outcome ?? latestState.challenge.provisionalOutcome
      },
      updatedAt: new Date().toISOString()
    });
  }

  private async initialize(challenge: Challenge): Promise<ChallengeObjectState> {
    const existing = await this.readState();
    const runAt = parseIsoDate(challenge.expiresAt);
    const objectState: ChallengeObjectState = {
      challenge,
      currentRunId: existing?.currentRunId ?? null,
      status: challenge.status,
      scheduledRunAt: challenge.status === "open" ? challenge.expiresAt : existing?.scheduledRunAt ?? null,
      lastScheduledSequence: existing?.lastScheduledSequence ?? 0,
      nextSequence: existing?.nextSequence ?? 1,
      updatedAt: new Date().toISOString()
    };
    await this.writeState(objectState);
    if (runAt && challenge.status === "open") {
      await this.state.storage.setAlarm(runAt);
    }
    return objectState;
  }

  private async ensureInitialized(challengeId: string): Promise<ChallengeObjectState> {
    const existing = await this.readState();
    if (existing?.challenge.id === challengeId) {
      return existing;
    }

    const challenge = await getChallenge(this.env, challengeId);
    if (!challenge) {
      throw new Error("Challenge not found.");
    }
    return this.initialize(challenge);
  }

  private async match(request: Request): Promise<Response> {
    const body = (await request.json()) as { challengeId: string; matcherId: string; amountCents: number };
    const challenge = await getChallenge(this.env, body.challengeId);
    if (!challenge) {
      return json({ error: "Challenge not found." }, { status: 404 });
    }

    validateMatchAmount(challenge, body.amountCents);
    const matchId = newId("mat");
    const side = oppositeSide(challenge.creatorSide);

    await lockFunds({
      env: this.env,
      userId: body.matcherId,
      amountCents: body.amountCents,
      type: "match_lock",
      challengeId: challenge.id,
      matchId,
      description: "Lock matcher challenge stake",
      idempotencyKey: `challenge-match:${matchId}`
    });

    const db = createDb(this.env.DATABASE_URL);
    await db.transaction(async (tx) => {
      const current = await tx.select().from(challenges).where(eq(challenges.id, challenge.id)).for("update").limit(1);
      if (!current[0]) {
        throw new Error("Challenge not found.");
      }

      await tx.insert(challengeMatches).values({
        id: matchId,
        challengeId: challenge.id,
        matcherId: body.matcherId,
        amountCents: body.amountCents,
        side
      });
      await tx
        .update(challenges)
        .set({
          matchedCents: current[0].matchedCents + body.amountCents,
          updatedAt: new Date()
        })
        .where(eq(challenges.id, challenge.id));
    });

    const updatedChallenge = await getChallenge(this.env, challenge.id);
    const objectState = await this.ensureInitialized(challenge.id);
    if (updatedChallenge) {
      await this.writeState({ ...objectState, challenge: updatedChallenge, status: updatedChallenge.status, updatedAt: new Date().toISOString() });
    }

    return json(
      { challenge: updatedChallenge, match: { id: matchId, amountCents: body.amountCents, side } },
      { status: 201 }
    );
  }

  private async stream(request: Request): Promise<Response> {
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: async ({ writer }) => {
          const textId = `resolver-${crypto.randomUUID()}`;
          let cursor = 0;

          writer.write({ type: "text-start", id: textId });
          writer.write({ type: "text-delta", id: textId, delta: "Subscribed to resolver events." });

          const emitNewEvents = async () => {
            const objectState = await this.readState();
            const events = await this.listEventsAfter(cursor);
            for (const event of events) {
              if (!this.shouldStreamEvent(event, objectState)) {
                cursor = Math.max(cursor, event.sequence);
                continue;
              }
              cursor = Math.max(cursor, event.sequence);
              writer.write({ type: "data-resolution-event", data: serializeEvent(event) } as any);
            }
          };

          await emitNewEvents();
          const startedAt = Date.now();
          while (!request.signal.aborted && Date.now() - startedAt < 10 * 60_000) {
            await new Promise((resolve) => setTimeout(resolve, 650));
            await emitNewEvents();
          }

          writer.write({ type: "text-end", id: textId });
        }
      })
    });
  }

  private shouldStreamEvent(event: StoredResolutionEvent, objectState: ChallengeObjectState | null): boolean {
    if (!objectState?.currentRunId) {
      return event.sequence >= (objectState?.lastScheduledSequence ?? 0);
    }
    return event.runId === objectState.currentRunId || (event.runId === null && event.sequence >= objectState.lastScheduledSequence);
  }

  private async appendEvent(event: Omit<ResolutionEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }): Promise<StoredResolutionEvent> {
    const objectState = await this.readState();
    const sequence = objectState?.nextSequence ?? 1;
    const storedEvent: StoredResolutionEvent = {
      id: event.id ?? newId("rev"),
      challengeId: event.challengeId,
      runId: event.runId ?? null,
      kind: event.kind,
      title: event.title,
      body: event.body ?? null,
      metadata: event.metadata ?? {},
      createdAt: event.createdAt ?? new Date().toISOString(),
      sequence
    };

    await this.state.storage.put(this.eventKey(sequence), storedEvent);
    if (objectState) {
      await this.writeState({ ...objectState, nextSequence: sequence + 1, updatedAt: new Date().toISOString() });
    }

    await createDb(this.env.DATABASE_URL)
      .insert(resolutionEvents)
      .values({
        id: storedEvent.id,
        challengeId: storedEvent.challengeId,
        runId: storedEvent.runId,
        kind: storedEvent.kind,
        title: storedEvent.title,
        body: storedEvent.body,
        metadata: JSON.stringify(storedEvent.metadata ?? {})
      })
      .onConflictDoNothing();

    return storedEvent;
  }

  private async markLastScheduledSequence(sequence: number): Promise<void> {
    const objectState = await this.readState();
    if (!objectState) {
      return;
    }
    await this.writeState({ ...objectState, lastScheduledSequence: sequence, updatedAt: new Date().toISOString() });
  }

  private async snapshot(): Promise<{ state: ChallengeObjectState | null; resolutionEvents: ResolutionEvent[]; currentRunId: string | null }> {
    const objectState = await this.readState();
    const events = await this.listEventsAfter(0);
    return {
      state: objectState,
      currentRunId: objectState?.currentRunId ?? null,
      resolutionEvents: events.filter((event) => this.shouldStreamEvent(event, objectState)).map(serializeEvent)
    };
  }

  private readState(): Promise<ChallengeObjectState | null> {
    return this.state.storage.get<ChallengeObjectState>("challenge_state").then((value) => value ?? null);
  }

  private writeState(objectState: ChallengeObjectState): Promise<void> {
    return this.state.storage.put("challenge_state", objectState);
  }

  private async listEventsAfter(sequence: number): Promise<StoredResolutionEvent[]> {
    const rows = await this.state.storage.list<StoredResolutionEvent>({ prefix: "resolver_events:" });
    return [...rows.values()].filter((event) => event.sequence > sequence).sort((a, b) => a.sequence - b.sequence);
  }

  private eventKey(sequence: number): string {
    return `resolver_events:${String(sequence).padStart(12, "0")}`;
  }

  private isInternalRequest(request: Request): boolean {
    const token = this.env.RESOLVER_TEST_TOKEN?.trim();
    if (!token) {
      return false;
    }
    const bearerToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    return bearerToken === token;
  }
}
