interface Env {
  API_ORIGIN?: string;
}

const defaultApiOrigin = "http://localhost:8787";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pathParam = params.path;
  const path = Array.isArray(pathParam) ? pathParam.join("/") : pathParam ?? "";
  const url = new URL(request.url);
  const isLocalRequest = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const targetOrigin = env.API_ORIGIN ?? (isLocalRequest ? defaultApiOrigin : undefined);

  if (!targetOrigin) {
    return new Response("API origin is not configured.", { status: 500 });
  }

  const targetUrl = new URL(`/api/${path}${url.search}`, targetOrigin);

  return fetch(targetUrl, request);
};
