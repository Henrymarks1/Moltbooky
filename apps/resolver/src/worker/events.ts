import type { ResolutionEvent } from "@moltbooky/core/domain/types";
import type { ResolveRequest } from "./types";
import { newId } from "./utils";

export async function appendResolutionEvent(
  request: ResolveRequest,
  kind: ResolutionEvent["kind"],
  title: string,
  body?: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const response = await fetch(request.eventCallbackUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${request.eventCallbackToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      id: newId("rev"),
      challengeId: request.challengeId,
      runId: request.runId,
      kind,
      title,
      body,
      metadata
    })
  });
  if (!response.ok) {
    throw new Error(`Could not append resolver event: ${response.status}`);
  }
}
