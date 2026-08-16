import { requireOperatorApi, verifyAgentRequest } from "@/lib/auth";
import { listPaymentViews } from "@/lib/db/queries";
import { paymentRequestSchema } from "@/lib/domain/validation";
import { errorResponse } from "@/lib/http";
import { createPaymentRequest } from "@/lib/services/payment-service";

export const runtime = "nodejs";

export async function GET() {
  const operator = await requireOperatorApi();
  if (!operator) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  return Response.json({ payments: await listPaymentViews() });
}

export async function POST(request: Request) {
  if (!verifyAgentRequest(request)) {
    return Response.json({ error: "INVALID_AGENT_CREDENTIAL" }, { status: 401 });
  }

  const authenticatedAgentId = process.env.AGENT_ID;
  if (!authenticatedAgentId) {
    return Response.json({ error: "AGENT_ID_NOT_CONFIGURED" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = paymentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_PAYMENT_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.agentId !== authenticatedAgentId) {
    return Response.json(
      { error: "AGENT_ID_MISMATCH" },
      { status: 403 },
    );
  }

  try {
    const result = await createPaymentRequest(parsed.data);
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
