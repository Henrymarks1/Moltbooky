import { z } from "@hono/zod-openapi";
import { createDb, creditAccounts, eq, pipedreamConnections } from "@moltbooky/db";
import { actorFromRequest, ensureBetaUser } from "./db";

export const errorResponseSchema = z.object({ error: z.string() });
export const sideSchema = z.enum(["YES", "NO"]);
export const challengeVisibilitySchema = z.enum(["public", "private"]);
export const dateTimeSchema = z.string().datetime();
export const centsSchema = z.number().int().min(0);
export const betaStakeCentsSchema = z.number().int().min(500).max(10_000);
export const creditValueSchema = z.union([z.string(), z.number()]);
export const idParamSchema = z.object({ id: z.string() });

const jsonRecordSchema = z.record(z.string(), z.unknown());
export const resolutionToolSchema = z.object({
  type: z.literal("pipedream_action"),
  appSlug: z.string().trim().min(1).max(80),
  appName: z.string().trim().max(120).optional(),
  authPropName: z.string().trim().min(1).max(80),
  accountId: z.string().trim().max(120).optional(),
  actionKey: z.string().trim().min(1).max(180),
  configuredProps: jsonRecordSchema.optional(),
  instructions: z.string().trim().max(2000).optional()
});
export const resolutionToolsSchema = z.array(resolutionToolSchema).max(8);
export const pipedreamConnectionIdsSchema = z.array(z.string().trim().min(1).max(120)).max(8).default([]);

export const requestDateTimeSchema = z.string().trim().transform((value, ctx) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: "custom", message: "Invalid datetime." });
    return z.NEVER;
  }
  return date.toISOString();
});

export const challengeKindSchema = z.enum(["open_match", "head_to_head"]);

export const requiredAppSchema = z.object({
  appSlug: z.string(),
  appName: z.string(),
  creatorConnectionId: z.string().nullable().optional(),
  opponentConnectionId: z.string().nullable().optional()
});

export const challengeSchema = z.object({
  id: z.string(),
  creatorId: z.string(),
  creatorName: z.string().nullable().optional(),
  claim: z.string(),
  resolutionCriteria: z.string(),
  resolutionTool: z.union([resolutionToolSchema, resolutionToolsSchema]).nullable().optional(),
  pipedreamConnectionIds: z.array(z.string()),
  creatorSide: sideSchema,
  kind: challengeKindSchema,
  invitedOpponentEmail: z.string().nullable().optional(),
  invitedOpponentId: z.string().nullable().optional(),
  acceptedAt: dateTimeSchema.nullable().optional(),
  requiredApps: z.array(requiredAppSchema).optional(),
  visibility: challengeVisibilitySchema,
  stakeCents: centsSchema,
  matchedCents: centsSchema,
  status: z.enum(["open", "pending_acceptance", "resolving", "provisional_resolved", "final_resolved", "cancelled", "expired_unmatched", "voided", "disputed"]),
  expiresAt: dateTimeSchema,
  disputeDeadlineAt: dateTimeSchema.nullable().optional(),
  provisionalOutcome: z.enum(["YES", "NO", "UNRESOLVED"]).nullable().optional(),
  createdAt: dateTimeSchema
});

export const challengeMatchSchema = z.object({
  id: z.string(),
  challengeId: z.string(),
  matcherId: z.string(),
  matcherName: z.string().nullable().optional(),
  amountCents: betaStakeCentsSchema,
  side: sideSchema,
  status: z.enum(["active", "settled", "cancelled"]),
  createdAt: dateTimeSchema
});

export const createdMatchSchema = z.object({
  id: z.string(),
  amountCents: betaStakeCentsSchema,
  side: sideSchema
});

export const resolutionRunSchema = z.object({
  id: z.string(),
  challengeId: z.string(),
  exaQuery: z.string(),
  sourceUrls: z.array(z.string()),
  aiRationale: z.string(),
  proposedOutcome: z.enum(["YES", "NO", "UNRESOLVED"]),
  confidence: z.number().min(0).max(1),
  createdAt: dateTimeSchema
});

export const resolutionEventSchema = z.object({
  id: z.string(),
  challengeId: z.string(),
  runId: z.string().nullable().optional(),
  kind: z.enum(["run_started", "model_step", "tool_call", "tool_result", "agent_output", "run_finished", "error"]),
  title: z.string(),
  body: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: dateTimeSchema
});

export const creditAccountSchema = z.object({
  userId: z.string(),
  availableCents: centsSchema,
  lockedCents: centsSchema
});

export const ledgerEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  amountCents: z.number().int(),
  challengeId: z.string().nullable(),
  matchId: z.string().nullable(),
  description: z.string(),
  createdAt: dateTimeSchema
});

export const errorResponses = {
  400: { description: "Bad request", content: { "application/json": { schema: errorResponseSchema } } },
  401: { description: "Unauthorized", content: { "application/json": { schema: errorResponseSchema } } },
  403: { description: "Forbidden", content: { "application/json": { schema: errorResponseSchema } } },
  404: { description: "Not found", content: { "application/json": { schema: errorResponseSchema } } }
} as const;

export function errorJson(c: any, message: string, status: 400 | 401 | 403 | 404 | 500) {
  return c.json({ error: message }, status) as any;
}

export function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function currentActor(env: Env, request: Request): Promise<{ userId: string; scopes: string[] }> {
  try {
    return await actorFromRequest(env, request);
  } catch (error) {
    if (!isLocalRequest(request) || !(error as Error).message.includes("BETTER_AUTH_SECRET")) {
      throw error;
    }

    const userId = request.headers.get("x-user-id") ?? "local-dev-user";
    await ensureBetaUser(env, userId);
    return { userId, scopes: ["*"] };
  }
}

function uniquePipedreamConnectionIds(ids: string[] = []): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(0, 8);
}

export async function validateUserPipedreamConnectionIds(env: Env, userId: string, ids: string[] = []): Promise<string[]> {
  const connectionIds = uniquePipedreamConnectionIds(ids);
  if (connectionIds.length === 0) {
    return [];
  }

  const db = createDb(env.DATABASE_URL);
  const rows = await db.select({ id: pipedreamConnections.id }).from(pipedreamConnections).where(eq(pipedreamConnections.userId, userId));
  const ownedIds = new Set(rows.map((row) => row.id));
  const missingId = connectionIds.find((id) => !ownedIds.has(id));
  if (missingId) {
    throw new Error(`Pipedream connection ${missingId} was not found for this user.`);
  }
  return connectionIds;
}

export async function applyCreditDelta(tx: any, userId: string, availableDeltaCents: number, lockedDeltaCents: number): Promise<void> {
  const creditAccount = await tx.select().from(creditAccounts).where(eq(creditAccounts.userId, userId)).for("update").limit(1);
  if (!creditAccount[0]) {
    throw new Error("Credit account not found.");
  }

  await tx
    .update(creditAccounts)
    .set({
      availableCents: creditAccount[0].availableCents + availableDeltaCents,
      lockedCents: creditAccount[0].lockedCents + lockedDeltaCents,
      updatedAt: new Date()
    })
    .where(eq(creditAccounts.userId, userId));
}
