interface Env {
  DATABASE_URL: string;
  LOADER?: WorkerLoader;
  EXA_API_KEY?: string;
  OPENAI_API_KEY?: string;
  BROWSER_USE_API_KEY?: string;
  BROWSER_USE_ENABLED?: string;
  BROWSER_USE_MODEL?: string;
  RESOLVER_TEST_TOKEN?: string;
  PIPEDREAM_CLIENT_ID?: string;
  PIPEDREAM_CLIENT_SECRET?: string;
  PIPEDREAM_PROJECT_ID?: string;
  PIPEDREAM_PROJECT_ENVIRONMENT?: string;
}

declare module "cloudflare:workers" {
  export class WorkerEntrypoint<Bindings = Env, Props = unknown> {
    env: Bindings;
    ctx: { props: Props };
  }
}
