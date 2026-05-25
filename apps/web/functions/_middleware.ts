interface Env {
  VITE_POSTHOG_TOKEN?: string;
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
}

export const onRequest: PagesFunction<Env> = async ({ env, next }) => {
  const response = await next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const token = env.VITE_POSTHOG_TOKEN ?? env.VITE_POSTHOG_KEY;
  if (!token) {
    return response;
  }

  const analyticsConfig = {
    posthogToken: token,
    posthogHost: env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com"
  };
  const script = `<script>window.__MOLTBOOKY_ANALYTICS__=${JSON.stringify(analyticsConfig)};</script>`;
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(html.replace("</head>", `${script}\n  </head>`), {
    status: response.status,
    headers
  });
};
