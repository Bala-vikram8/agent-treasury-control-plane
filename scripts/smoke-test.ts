import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { SignJWT } from "jose";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the production smoke test");
}

const port = Number(process.env.SMOKE_PORT ?? 3_100);
const baseUrl = `http://127.0.0.1:${port}`;
const agentToken = "smoke_agent_service_token";
const agentId = "routepilot-client";
const sessionSecret = "smoke_session_secret_with_at_least_32_characters";
let serverOutput = "";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForServer(server: ReturnType<typeof spawn>) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited early.\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
    } catch {
      // The production server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Production server did not become healthy.\n${serverOutput}`);
}

async function stopServer(server: ReturnType<typeof spawn>) {
  if (server.exitCode !== null) return;

  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);

  if (server.exitCode === null) server.kill("SIGKILL");
}

const server = spawn("node", [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    AGENT_SERVICE_TOKEN: agentToken,
    AGENT_ID: agentId,
    OPERATOR_PASSWORD: "smoke_operator_password",
    SESSION_SECRET: sessionSecret,
    STRIPE_SECRET_KEY: "sk_test_not_used_by_smoke_test",
    STRIPE_WEBHOOK_SECRET: "whsec_not_used_by_smoke_test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout?.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr?.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  const health = await waitForServer(server);
  assert(health.headers.get("x-frame-options") === "DENY", "Security headers missing");

  const runId = randomUUID();
  const requestPayload = {
    agentId,
    idempotencyKey: `routepilot:smoke:${runId}`,
    merchant: "OrbitRoute Maps",
    category: "Mapping API",
    purpose: "Production server smoke test",
    amountCents: 4_280,
    currency: "USD",
    riskScore: 31,
  };
  const agentHeaders = {
    authorization: `Bearer ${agentToken}`,
    "content-type": "application/json",
  };

  const createdResponse = await fetch(`${baseUrl}/api/payment-requests`, {
    method: "POST",
    headers: agentHeaders,
    body: JSON.stringify(requestPayload),
  });
  const created = await createdResponse.json();
  assert(createdResponse.status === 201, "Machine request was not created");
  assert(created.payment?.request.state === "REVIEW_REQUIRED", "Policy state is wrong");
  const paymentRequestId = created.payment.request.id as string;

  const replayResponse = await fetch(`${baseUrl}/api/payment-requests`, {
    method: "POST",
    headers: agentHeaders,
    body: JSON.stringify(requestPayload),
  });
  const replay = await replayResponse.json();
  assert(replayResponse.status === 200, "Idempotent replay did not return existing data");
  assert(replay.payment?.request.id === paymentRequestId, "Replay created another request");

  const conflictResponse = await fetch(`${baseUrl}/api/payment-requests`, {
    method: "POST",
    headers: agentHeaders,
    body: JSON.stringify({ ...requestPayload, amountCents: 4_281 }),
  });
  const conflict = await conflictResponse.json();
  assert(conflictResponse.status === 409, "Changed replay did not return a conflict");
  assert(conflict.error === "IDEMPOTENCY_KEY_REUSED", "Conflict code is wrong");

  const operatorToken = await new SignJWT({ role: "operator" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("portfolio-operator")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(sessionSecret));
  const operatorHeaders = {
    cookie: `treasury_operator_session=${operatorToken}`,
    "content-type": "application/json",
  };

  const deniedResponse = await fetch(
    `${baseUrl}/api/payment-requests/${paymentRequestId}/deny`,
    {
      method: "POST",
      headers: operatorHeaders,
      body: JSON.stringify({ reason: "Smoke test decision" }),
    },
  );
  const denied = await deniedResponse.json();
  assert(deniedResponse.status === 200, "Operator decision failed");
  assert(denied.payment?.request.state === "DENIED", "Operator state is wrong");

  const dashboardResponse = await fetch(`${baseUrl}/api/dashboard/summary`, {
    headers: { cookie: operatorHeaders.cookie },
  });
  const dashboard = await dashboardResponse.json();
  assert(dashboardResponse.status === 200, "Dashboard summary was unavailable");
  assert(
    dashboard.requests?.some(
      (item: { request?: { id?: string; state?: string } }) =>
        item.request?.id === paymentRequestId && item.request.state === "DENIED",
    ),
    "Dashboard did not return the persisted operator decision",
  );

  console.log("Production smoke test passed.");
} finally {
  await stopServer(server);
}
