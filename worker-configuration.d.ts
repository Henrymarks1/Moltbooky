interface Env {
  DB: D1Database;
  RESOLUTION_QUEUE: Queue;
  CHALLENGE_OBJECT: DurableObjectNamespace;
  EXA_API_KEY?: string;
  OPENAI_API_KEY?: string;
  PAYMENT_LAUNCH_APPROVED?: string;
}
