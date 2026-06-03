interface Env {
  DATABASE_URL: string;
  LOADER?: {
    load(code: {
      mainModule: string;
      modules: Record<string, unknown>;
      compatibilityDate: string;
      globalOutbound?: unknown;
      env?: Record<string, unknown>;
    }): {
      getEntrypoint(): {
        fetch(request: Request): Promise<Response>;
      };
    };
  };
  EXA_API_KEY?: string;
  OPENAI_API_KEY?: string;
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
