import { absoluteUrl, escapeHtml, fetchChallengePreview, formatShortDate, money, truncate, type ShareEnv } from "../_share-utils";

const genericTitle = "Moltbooky";
const genericDescription = "Create and match 1:1 challenge markets on Moltbooky.";
const replacedMetaKeys = [
  "description",
  "theme-color",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "og:type",
  "og:site_name",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
  "og:image:secure_url",
  "og:image:type",
  "og:image:width",
  "og:image:height",
  "og:image:alt"
];

export const onRequest: PagesFunction<ShareEnv> = async ({ request, params, env, next }) => {
  const response = await next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const data = id ? await fetchChallengePreview(request, env, id) : null;
  const challenge = data?.challenge;
  const url = new URL(request.url);
  const canonicalUrl = absoluteUrl(request, url.pathname);
  const imageUrl = id ? absoluteUrl(request, `/share/challenge/${encodeURIComponent(id)}`) : absoluteUrl(request, "/share/challenge/preview");
  const fallbackImageUrl = absoluteUrl(request, "/share-default.png");

  const title = challenge ? `${truncate(challenge.claim, 82)} | Moltbooky` : genericTitle;
  const description = challenge
    ? `${money(challenge.stakeCents)} ${challenge.creatorSide} at 1:1 odds. ${money(data.availableToMatchCents)} still available to match before ${formatShortDate(challenge.expiresAt)}.`
    : genericDescription;

  const metaTags = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Moltbooky" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image" content="${escapeHtml(fallbackImageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(fallbackImageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(challenge?.claim ?? "Moltbooky challenge market")}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(fallbackImageUrl)}" />
    <meta name="theme-color" content="#0f172a" />`;

  const html = stripDefaultShareTags(await response.text());
  const nextHeaders = new Headers(response.headers);
  nextHeaders.set("content-type", "text/html; charset=utf-8");
  nextHeaders.set("cache-control", "public, max-age=60");

  return new Response(html.replace("</head>", `${metaTags}\n  </head>`), {
    status: response.status,
    headers: nextHeaders
  });
};

function stripDefaultShareTags(html: string): string {
  const keys = replacedMetaKeys.map(escapeRegExp).join("|");
  return html
    .replace(/<title>.*?<\/title>/i, "")
    .replace(new RegExp(`\\s*<meta\\s+(?:name|property)=["'](?:${keys})["'][^>]*>`, "gi"), "")
    .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
