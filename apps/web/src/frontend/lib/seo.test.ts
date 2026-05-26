import { describe, expect, it } from "vitest";
import { defaultSeo, seoForPath } from "./seo";

describe("seo route metadata", () => {
  it("returns configured route metadata", () => {
    expect(seoForPath("/how-it-works")).toMatchObject({
      title: "How Moltbooky Works | 1:1 Challenge Markets",
      path: "/how-it-works"
    });
  });

  it("uses challenge metadata for dynamic challenge routes", () => {
    expect(seoForPath("/challenge/ch_123")).toMatchObject({
      title: "Challenge Market | Moltbooky",
      path: "/challenge/ch_123"
    });
  });

  it("keeps the challenge creation route private", () => {
    expect(seoForPath("/challenge/new")).toMatchObject({
      title: "Create a Challenge Market | Moltbooky",
      robots: "noindex,follow"
    });
  });

  it("falls back to default metadata for unknown paths", () => {
    expect(seoForPath("/missing")).toBe(defaultSeo);
  });
});
