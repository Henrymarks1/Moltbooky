interface Env {
  DATABASE_URL: string;
  CHALLENGE_OBJECT: DurableObjectNamespace;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PAYMENT_LAUNCH_APPROVED?: string;
}
