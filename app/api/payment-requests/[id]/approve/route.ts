import { requireOperatorApi } from "@/lib/auth";
import { operatorDecisionSchema } from "@/lib/domain/validation";
import { errorResponse } from "@/lib/http";
import { approvePaymentRequest } from "@/lib/services/payment-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const operator = await requireOperatorApi();
  if (!operator) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = operatorDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_DECISION", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    return Response.json({
      payment: await approvePaymentRequest(
        id,
        operator.actorId,
        parsed.data.reason,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
