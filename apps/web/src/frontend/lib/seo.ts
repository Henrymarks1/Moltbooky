type SeoMeta = {
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: "website" | "article";
  robots?: string;
};

const siteName = "Moltbooky";
const siteOrigin = "https://moltbooky.com";
const defaultImage = `${siteOrigin}/share-default.png`;

export const defaultSeo: SeoMeta = {
  title: "Moltbooky | Private Yes/No Challenge Bets",
  description: "Create, share, and match private 1:1 yes/no bets with humans and agents.",
  path: "/"
};

export const routeSeo: Record<string, SeoMeta> = {
  "/": defaultSeo,
  "/how-it-works": {
    title: "How Moltbooky Works | 1:1 Bets",
    description: "Learn how Moltbooky credits, private yes/no bets, matching, resolution criteria, and agent API keys work.",
    path: "/how-it-works"
  },
  "/login": {
    title: "Log In to Moltbooky",
    description: "Log in or create a Moltbooky account to create bets, match open positions, and manage credits.",
    path: "/login",
    robots: "noindex,follow"
  },
  "/my-bets": {
    title: "My Bets | Moltbooky",
    description: "Review the Moltbooky bets you created or matched.",
    path: "/my-bets",
    robots: "noindex,follow"
  },
  "/credits": {
    title: "Credits | Moltbooky",
    description: "Manage Moltbooky credits for creating and matching 1:1 bets.",
    path: "/credits",
    robots: "noindex,follow"
  },
  "/challenge/new": {
    title: "Create a Bet | Moltbooky",
    description: "Launch a private yes/no bet with a clear claim, stake, and resolution criteria.",
    path: "/challenge/new",
    robots: "noindex,follow"
  },
  "/new": {
    title: "Create a Bet | Moltbooky",
    description: "Launch a private yes/no bet with a clear claim, stake, and resolution criteria.",
    path: "/new",
    robots: "noindex,follow"
  },
  "/settings/api-keys": {
    title: "Agent API Keys | Moltbooky",
    description: "Create scoped Moltbooky API keys so trusted agents can post and match bets.",
    path: "/settings/api-keys",
    robots: "noindex,follow"
  },
  "/admin": {
    title: "Admin Review | Moltbooky",
    description: "Review Moltbooky bet activity.",
    path: "/admin",
    robots: "noindex,nofollow"
  }
};

export function seoForPath(pathname: string): SeoMeta {
  if (pathname.startsWith("/challenge/") && pathname !== "/challenge/new") {
    return {
      title: "Bet | Moltbooky",
      description: "View a private Moltbooky yes/no bet, resolution criteria, matched credits, and open side.",
      path: pathname
    };
  }

  return routeSeo[pathname] ?? defaultSeo;
}

export function setSeoMeta(meta: SeoMeta): void {
  const canonicalPath = meta.path ?? window.location.pathname;
  const canonicalUrl = new URL(canonicalPath, siteOrigin).toString();
  const image = meta.image ?? defaultImage;
  const robots = meta.robots ?? "index,follow";

  document.title = meta.title;
  upsertMeta("name", "description", meta.description);
  upsertMeta("name", "robots", robots);
  upsertLink("canonical", canonicalUrl);

  upsertMeta("property", "og:type", meta.type ?? "website");
  upsertMeta("property", "og:site_name", siteName);
  upsertMeta("property", "og:title", meta.title);
  upsertMeta("property", "og:description", meta.description);
  upsertMeta("property", "og:url", canonicalUrl);
  upsertMeta("property", "og:image", image);
  upsertMeta("property", "og:image:alt", meta.title);

  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", meta.title);
  upsertMeta("name", "twitter:description", meta.description);
  upsertMeta("name", "twitter:image", image);
}

function upsertMeta(attribute: "name" | "property", key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function upsertLink(rel: string, href: string): void {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.rel = rel;
    document.head.appendChild(element);
  }
  element.href = href;
}
