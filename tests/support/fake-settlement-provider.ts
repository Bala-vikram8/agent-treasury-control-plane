import type { PaymentRequestRow } from "@/lib/db/schema";
import type { SettlementProvider } from "@/lib/services/settlement-provider";

export class FakeSettlementProvider implements SettlementProvider {
  readonly calls: string[] = [];

  async createTestPayment(request: PaymentRequestRow) {
    this.calls.push(request.id);
    return {
      providerPaymentId: `pi_test_${request.id.replaceAll("-", "")}`,
      providerStatus: "processing",
    };
  }
}
