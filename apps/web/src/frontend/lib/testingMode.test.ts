import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTestingModeEnabled, setTestingModeEnabled, testingModeChangeEvent } from "./testingMode";

describe("testing mode", () => {
  let store: Map<string, string>;
  let dispatchEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new Map();
    dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        }
      },
      dispatchEvent
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads testing mode from local storage", () => {
    expect(isTestingModeEnabled()).toBe(false);

    store.set("moltbooky.testingMode.enabled", "true");

    expect(isTestingModeEnabled()).toBe(true);
  });

  it("writes testing mode and notifies listeners", () => {
    setTestingModeEnabled(true);

    expect(store.get("moltbooky.testingMode.enabled")).toBe("true");
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: testingModeChangeEvent }));
  });

  it("returns false outside a browser environment", () => {
    vi.stubGlobal("window", undefined);

    expect(isTestingModeEnabled()).toBe(false);
    expect(() => setTestingModeEnabled(true)).not.toThrow();
  });
});
