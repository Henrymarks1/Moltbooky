import type { Challenge, ResolutionEvent, ResolutionOutcome, ResolutionTool } from "@moltbooky/core/domain/types";
import { z } from "zod";

export interface ResolverResult {
  outcome: ResolutionOutcome;
  confidence: number;
  sourceUrls: string[];
  shortRationale: string;
  finalized?: boolean;
}

export type ResolverPipedreamTool = ResolutionTool & {
  connectionId?: string;
  // The Pipedream external user id (= app user id) whose stored OAuth grant authenticates calls
  // for this connection. Lets a single resolver run reach BOTH participants' accounts.
  externalUserId?: string;
  // Human label distinguishing whose account this is, e.g. "Henry (creator)" / "Ben (opponent)".
  participantLabel?: string;
};

export type ResolutionEventEmitter = (
  kind: ResolutionEvent["kind"],
  title: string,
  body?: string | null,
  metadata?: Record<string, unknown>
) => Promise<void>;

export const resolveRequestSchema = z.object({
  challengeId: z.string().min(1),
  runId: z.string().min(1),
  challenge: z.object({
    id: z.string().min(1),
    creatorId: z.string().min(1),
    claim: z.string().min(1),
    resolutionCriteria: z.string().min(1),
    resolutionTool: z.unknown().nullable().optional(),
    pipedreamConnectionIds: z.array(z.string()).default([]),
    creatorSide: z.enum(["YES", "NO"]),
    visibility: z.enum(["public", "private"]),
    stakeCents: z.number().int(),
    matchedCents: z.number().int(),
    status: z.string(),
    expiresAt: z.string()
  }),
  eventCallbackUrl: z.string().url(),
  finalizeCallbackUrl: z.string().url(),
  eventCallbackToken: z.string().min(1)
});

export type ResolveRequest = z.infer<typeof resolveRequestSchema> & { challenge: Challenge };
