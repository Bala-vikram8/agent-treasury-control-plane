import { randomUUID } from "node:crypto";

const apiUrl = process.env.AGENT_API_URL ?? "http://localhost:3000";
const serviceToken = process.env.AGENT_SERVICE_TOKEN;

if (!serviceToken) {
  throw new Error("AGENT_SERVICE_TOKEN is required");
}

const runId = process.env.DEMO_RUN_ID ?? randomUUID().slice(0, 8);
const scenarios = [
  {
    name: "automatic approval",
    payload: {
      agentId: "routepilot-client",
      idempotencyKey: `routepilot:${runId}:automatic`,
      merchant: "CloudVector",
      category: "Cloud compute",
      purpose: "Batch inference capacity",
      amountCents: 1_825,
      currency: "USD",
      riskScore: 12,
    },
  },
  {
    name: "human review",
    payload: {
      agentId: "routepilot-client",
      idempotencyKey: `routepilot:${runId}:review`,
      merchant: "OrbitRoute Maps",
      category: "Mapping API",
      purpose: "Emergency route optimization credits",
      amountCents: 4_280,
      currency: "USD",
      riskScore: 31,
    },
  },
  {
    name: "automatic denial",
    payload: {
      agentId: "routepilot-client",
      idempotencyKey: `routepilot:${runId}:denial`,
      merchant: "Unknown vendor",
      category: "Unclassified",
      purpose: "Premium data access",
      amountCents: 7_600,
      currency: "USD",
      riskScore: 86,
    },
  },
] as const;

for (const scenario of scenarios) {
  const response = await fetch(`${apiUrl}/api/payment-requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(scenario.payload),
  });
  const result = await response.json();

  console.log(`\n${scenario.name.toUpperCase()} (${response.status})`);
  console.dir(result, { depth: 5 });
}

console.log(`\nDemo run id: ${runId}`);
console.log("Reuse DEMO_RUN_ID with this value to verify idempotent retries.");
