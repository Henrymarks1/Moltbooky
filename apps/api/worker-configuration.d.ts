interface Env {
  DATABASE_URL: string;
  RESOLUTION_QUEUE: Queue;
  CHALLENGE_OBJECT: DurableObjectNamespace;
  EXA_API_KEY?: string;
  OPENAI_API_KEY?: string;
  BETTER_AUTH_SECRET?: string;
  PAYMENT_LAUNCH_APPROVED?: string;
}
