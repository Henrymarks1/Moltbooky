import { spawn } from "node:child_process";

const forwardTo = "http://localhost:8789/api/payments/stripe/webhook";
const children = new Set();
let workerStarted = false;
let shuttingDown = false;
let stripeOutput = "";

function prefixOutput(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.length > 0) {
      console.log(`[${name}] ${line}`);
    }
  }
}

function spawnChild(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["inherit", "pipe", "pipe"],
    ...options
  });

  children.add(child);
  child.stdout.on("data", (chunk) => prefixOutput(name, chunk));
  child.stderr.on("data", (chunk) => prefixOutput(name, chunk));
  child.on("error", (error) => {
    console.error(`[${name}] ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && (code !== 0 || signal)) {
      console.error(`[${name}] exited with ${signal ?? code}.`);
      shutdown(code ?? 1);
    }
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
}

function startWorker(webhookSecret) {
  if (workerStarted) {
    return;
  }

  workerStarted = true;
  console.log("[dev] Captured Stripe webhook secret; starting payments worker on :8789.");
  spawnChild("payments", "pnpm", [
    "exec",
    "wrangler",
    "dev",
    "--port",
    "8789",
    "--inspector-port",
    "0",
    "--var",
    `STRIPE_WEBHOOK_SECRET:${webhookSecret}`
  ]);
}

console.log(`[dev] Starting Stripe listener and forwarding webhooks to ${forwardTo}.`);
const stripe = spawnChild("stripe", "stripe", ["listen", "--forward-to", forwardTo]);

const secretTimeout = setTimeout(() => {
  if (!workerStarted) {
    console.error("[dev] Stripe CLI did not print a webhook signing secret. Run `stripe login` and try again.");
    shutdown(1);
  }
}, 30_000);

function watchForSecret(chunk) {
  stripeOutput += chunk.toString();
  const secret = stripeOutput.match(/whsec_[A-Za-z0-9_]+/)?.[0];
  if (secret) {
    clearTimeout(secretTimeout);
    startWorker(secret);
  }
}

stripe.stdout.on("data", watchForSecret);
stripe.stderr.on("data", watchForSecret);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
