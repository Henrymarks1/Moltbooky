import posthog from "posthog-js";
import type { AuthUser } from "../routes/root";

type AnalyticsConfig = {
  posthogToken?: string;
  posthogHost?: string;
};

declare global {
  interface Window {
    __MOLTBOOKY_ANALYTICS__?: AnalyticsConfig;
  }
}

const runtimeConfig = typeof window === "undefined" ? undefined : window.__MOLTBOOKY_ANALYTICS__;
const posthogToken = runtimeConfig?.posthogToken ?? import.meta.env.VITE_POSTHOG_TOKEN ?? import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = runtimeConfig?.posthogHost ?? import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

export function initAnalytics(): void {
  if (!posthogToken || posthog.__loaded) {
    return;
  }

  posthog.init(posthogToken, {
    api_host: posthogHost,
    capture_pageview: false,
    defaults: "2025-11-30",
    person_profiles: "identified_only"
  });
}

export function capturePageview(): void {
  if (!posthog.__loaded) {
    return;
  }

  posthog.capture("$pageview", {
    $current_url: window.location.href
  });
}

export function identifyAnalyticsUser(user: AuthUser): void {
  if (!posthog.__loaded) {
    return;
  }

  posthog.identify(user.id, {
    email: user.email,
    name: user.name
  });
}

export function resetAnalyticsUser(): void {
  if (!posthog.__loaded) {
    return;
  }

  posthog.reset();
}
