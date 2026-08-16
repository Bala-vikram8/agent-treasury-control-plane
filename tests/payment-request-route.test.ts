import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/payment-requests/route";

const originalToken = process.env.AGENT_SERVICE_TOKEN;
const originalAgentId = process.env.AGENT_ID;

const payload = {
  agentId: "spoofed-agent",
  idempotencyKey: "routepilot:identity:test",
  merchant: "CloudVector",
  category: "Cloud compute",
  purpose: "Identity boundary test",
  amountCents: 1_825,
  currency: "USD",
  riskScore: 12,
};

afterEach(() => {
  if (originalToken === undefined) delete process.env.AGENT_SERVICE_TOKEN;
  else process.env.AGENT_SERVICE_TOKEN = originalToken;

  if (originalAgentId === undefined) delete process.env.AGENT_ID;
  else process.env.AGENT_ID = originalAgentId;
});

describe("machine request identity boundary", () => {
  it("rejects a valid token attempting to spend as another agent", async () => {
    process.env.AGENT_SERVICE_TOKEN = "test_agent_service_token";
    process.env.AGENT_ID = "routepilot-client";

    const response = await POST(
      new Request("http://localhost/api/payment-requests", {
        method: "POST",
        headers: {
          authorization: "Bearer test_agent_service_token",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "AGENT_ID_MISMATCH",
    });
  });

  it("rejects an invalid machine credential", async () => {
    process.env.AGENT_SERVICE_TOKEN = "test_agent_service_token";
    process.env.AGENT_ID = "routepilot-client";

    const response = await POST(
      new Request("http://localhost/api/payment-requests", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong_token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...payload, agentId: "routepilot-client" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_AGENT_CREDENTIAL",
    });
  });
});
