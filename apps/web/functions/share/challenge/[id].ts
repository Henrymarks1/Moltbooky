import { escapeHtml, fetchChallengePreview, formatShortDate, money, wrapText, type ShareEnv } from "../../_share-utils";

export const onRequest: PagesFunction<ShareEnv> = async ({ request, params, env }) => {
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const data = id ? await fetchChallengePreview(request, env, id) : null;
  const challenge = data?.challenge;

  const claim = challenge?.claim ?? "A live Moltbooky challenge is open";
  const side = challenge?.creatorSide ?? "YES";
  const stake = money(challenge?.stakeCents ?? 2500);
  const available = money(data?.availableToMatchCents ?? 2500);
  const matched = money(challenge?.matchedCents ?? 0);
  const expires = challenge ? formatShortDate(challenge.expiresAt) : "Open now";
  const oppositeSide = side === "YES" ? "NO" : "YES";
  const progress = challenge && challenge.stakeCents > 0 ? Math.min(100, Math.round((challenge.matchedCents / challenge.stakeCents) * 100)) : 18;
  const claimLines = wrapText(claim, 34, 4);
  const criteria = challenge?.resolutionCriteria ? wrapText(challenge.resolutionCriteria, 62, 2) : ["Take the other side at 1:1 odds before this market closes."];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#09111f"/>
      <stop offset="0.48" stop-color="#11243a"/>
      <stop offset="1" stop-color="#15100d"/>
    </linearGradient>
    <linearGradient id="hot" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#50f0b4"/>
      <stop offset="0.48" stop-color="#f8d66d"/>
      <stop offset="1" stop-color="#ff6b6b"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="26" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <path d="M0 468 C160 398 234 592 410 512 C580 435 667 282 840 328 C990 368 1038 502 1200 418 L1200 630 L0 630 Z" fill="#50f0b4" opacity="0.12"/>
  <path d="M740 -70 C892 34 960 174 1164 130" fill="none" stroke="#f8d66d" stroke-width="104" opacity="0.13" stroke-linecap="round"/>
  <path d="M-30 152 C135 90 242 98 380 22" fill="none" stroke="#ff6b6b" stroke-width="78" opacity="0.10" stroke-linecap="round"/>

  <g filter="url(#shadow)">
    <rect x="70" y="58" width="1060" height="514" rx="34" fill="#f8fafc"/>
    <rect x="70" y="58" width="1060" height="514" rx="34" fill="#ffffff"/>
  </g>

  <g transform="translate(108 96)">
    <rect x="0" y="0" width="58" height="58" rx="17" fill="#0f172a"/>
    <text x="29" y="39" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="900" fill="#ffffff">M</text>
    <text x="76" y="25" font-family="Inter, Arial, sans-serif" font-size="23" font-weight="850" fill="#0f172a">Moltbooky</text>
    <text x="76" y="51" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#64748b">1:1 challenge market</text>
  </g>

  <g transform="translate(108 194)">
    ${claimLines.map((line, index) => `<text x="0" y="${index * 58}" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="900" fill="#0f172a">${escapeHtml(line)}</text>`).join("")}
  </g>

  <g transform="translate(108 438)">
    ${criteria.map((line, index) => `<text x="0" y="${index * 28}" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="650" fill="#475569">${escapeHtml(line)}</text>`).join("")}
  </g>

  <g transform="translate(786 108)">
    <rect x="0" y="0" width="304" height="324" rx="28" fill="#0f172a"/>
    <text x="32" y="53" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="850" fill="#94a3b8">CREATOR BETS</text>
    <text x="32" y="122" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="950" fill="${side === "YES" ? "#50f0b4" : "#ff6b6b"}">${side}</text>
    <text x="32" y="168" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="850" fill="#ffffff">${escapeHtml(stake)}</text>
    <text x="32" y="221" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="850" fill="#94a3b8">TAKE ${oppositeSide} FOR</text>
    <text x="32" y="265" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="950" fill="#f8d66d">${escapeHtml(available)}</text>
    <text x="32" y="301" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#cbd5e1">1:1 odds</text>
  </g>

  <g transform="translate(108 528)">
    <rect x="0" y="0" width="560" height="13" rx="7" fill="#e2e8f0"/>
    <rect x="0" y="0" width="${Math.max(22, Math.round(560 * progress / 100))}" height="13" rx="7" fill="url(#hot)"/>
    <text x="0" y="45" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#64748b">${escapeHtml(matched)} matched</text>
    <text x="430" y="45" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#64748b">Expires ${escapeHtml(expires)}</text>
  </g>

  <g transform="translate(786 474)">
    <rect x="0" y="0" width="304" height="70" rx="22" fill="#fff7ed" stroke="#fed7aa"/>
    <text x="28" y="43" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="950" fill="#9a3412">Paste-worthy stakes</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
};
