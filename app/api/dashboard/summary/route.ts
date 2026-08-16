import { requireOperatorApi } from "@/lib/auth";
import { getDashboardData } from "@/lib/db/queries";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const operator = await requireOperatorApi();
  if (!operator) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    return Response.json(await getDashboardData());
  } catch (error) {
    return errorResponse(error);
  }
}
