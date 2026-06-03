import type { ResolutionEvent } from "@moltbooky/core/domain/types";

export function getLatestBrowserUseLiveUrl(events: ResolutionEvent[]): string | null {
  for (const event of [...events].sort((left, right) => getEventSequence(right) - getEventSequence(left))) {
    const liveUrl = getMetadataString(event, "browserUseLiveUrl");
    if (liveUrl) {
      return liveUrl;
    }
  }
  return null;
}

function getEventSequence(event: ResolutionEvent): number {
  const sequence = event.metadata?.sequence;
  return typeof sequence === "number" ? sequence : new Date(event.createdAt).getTime();
}

function getMetadataString(event: ResolutionEvent, key: string): string | null {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}
