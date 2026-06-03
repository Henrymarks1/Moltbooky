export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function summarizeToolOutput(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  if (!text) {
    return "Tool returned no text output.";
  }
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

export function collectUrls(value: unknown, urls = new Set<string>()): string[] {
  if (!value) {
    return Array.from(urls);
  }
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      urls.add(match[0]);
    }
    return Array.from(urls);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, urls);
    }
    return Array.from(urls);
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectUrls(item, urls);
    }
  }
  return Array.from(urls);
}
