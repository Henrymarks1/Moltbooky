interface Env {
  DATABASE_URL: string;
  CHALLENGE_OBJECT: DurableObjectNamespace;
  BETTER_AUTH_SECRET?: string;
  PAYMENT_LAUNCH_APPROVED?: string;
}
