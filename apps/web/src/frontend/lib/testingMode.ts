import type { AuthUser } from "../routes/root";

export const testingModeChangeEvent = "moltbooky-testing-mode-change";

const testingModeKey = "moltbooky.testingMode.enabled";

export const testingUser: AuthUser = {
  id: "play-money-user",
  name: "Play Money Tester",
  email: "tester@moltbooky.local"
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function isTestingModeEnabled(): boolean {
  if (!canUseStorage()) {
    return false;
  }
  return window.localStorage.getItem(testingModeKey) === "true";
}

export function setTestingModeEnabled(enabled: boolean): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(testingModeKey, String(enabled));
  window.dispatchEvent(new Event(testingModeChangeEvent));
}
