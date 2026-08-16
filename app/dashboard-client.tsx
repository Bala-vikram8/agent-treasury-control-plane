"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardData } from "@/lib/db/queries";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const stateLabels: Record<string, string> = {
  RECEIVED: "Received",
  REVIEW_REQUIRED: "Human review",
  DENIED: "Denied",
  SETTLING: "Settling",
  SETTLED: "Settled",
  FAILED: "Failed",
};

function formatCents(cents: number) {
  return money.format(cents / 100);
}

function StatusPill({ state }: { state: string }) {
  return (
    <span className={`status-pill status-${state.toLowerCase()}`}>
      {stateLabels[state] ?? state}
    </span>
  );
}

export default function DashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const initialId =
    data.requests.find((item) => item.request.state === "REVIEW_REQUIRED")?.request
      .id ?? data.requests[0]?.request.id;
  const [selectedId, setSelectedId] = useState(initialId);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(
    () => data.requests.find((item) => item.request.id === selectedId),
    [data.requests, selectedId],
  );

  const reconciliationRate = data.summary.requestCount
    ? Math.round((data.summary.settledCount / data.summary.requestCount) * 100)
    : 0;

  async function decide(action: "approve" | "deny") {
    if (!selected) return;
    setProcessing(true);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/payment-requests/${selected.request.id}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "Reviewed in treasury control room" }),
        },
      );
      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(result.message ?? `Request failed with ${response.status}`);
      }

      setNotice(
        action === "approve"
          ? "Approved. Stripe sandbox settlement was submitted."
          : "Denied. No settlement was created.",
      );
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Decision failed");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="content-wrap">
      <section className="page-heading">
        <div>
          <p className="eyebrow">LIVE CONTROL ROOM</p>
          <h1>Machine requests. Human control.</h1>
          <p className="heading-copy">
            RoutePilot requests authorization for test payments. Policy handles safe
            requests automatically and sends exceptions to an operator.
          </p>
        </div>
        <div className="heading-stat">
          <span>Denied today</span>
          <strong>{formatCents(data.summary.deniedCents)}</strong>
          <small>{data.summary.deniedCount} blocked requests</small>
        </div>
      </section>

      <section className="metric-grid" aria-label="Treasury summary">
        <article>
          <p>Daily policy budget</p>
          <strong>{formatCents(data.summary.dailyBudgetCents)}</strong>
          <span>{data.policy.version}</span>
        </article>
        <article>
          <p>Available</p>
          <strong>{formatCents(data.summary.availableCents)}</strong>
          <span className="positive">Computed from Postgres</span>
        </article>
        <article>
          <p>Pending review</p>
          <strong>{formatCents(data.summary.pendingCents)}</strong>
          <span className="attention">{data.summary.pendingCount} decisions needed</span>
        </article>
        <article>
          <p>Settled requests</p>
          <strong>{reconciliationRate}%</strong>
          <span>{data.summary.settledCount} of {data.summary.requestCount} requests</span>
        </article>
      </section>

      {selected ? (
        <div className="dashboard-grid">
          <section className="decision-panel" aria-labelledby="decision-title">
            <div className="panel-header">
              <div>
                <p className="eyebrow">PAYMENT REQUEST</p>
                <h2 id="decision-title">
                  {selected.request.agentId} requests {formatCents(selected.request.amountCents)}
                </h2>
              </div>
              <StatusPill state={selected.request.state} />
            </div>

            <div className="request-summary">
              <div className="merchant-avatar">
                {selected.request.merchant.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p>Merchant</p>
                <strong>{selected.request.merchant}</strong>
                <small>{selected.request.category}</small>
              </div>
              <div className="request-amount">
                <p>Requested</p>
                <strong>{formatCents(selected.request.amountCents)}</strong>
                <small>{selected.request.currency}</small>
              </div>
            </div>

            <dl className="request-details">
              <div>
                <dt>Purpose</dt>
                <dd>{selected.request.purpose}</dd>
              </div>
              <div>
                <dt>Request ID</dt>
                <dd>{selected.request.id.slice(0, 8)}</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>{selected.request.riskScore} / 100</dd>
              </div>
              <div>
                <dt>Created UTC</dt>
                <dd>{new Date(selected.request.createdAt).toISOString().slice(11, 19)}</dd>
              </div>
            </dl>

            {selected.settlement ? (
              <div className="settlement-evidence">
                <div>
                  <p>Settlement evidence</p>
                  <strong>{selected.settlement.provider.toUpperCase()}</strong>
                </div>
                <div>
                  <p>Provider status</p>
                  <strong>{selected.settlement.status}</strong>
                </div>
                <div className="settlement-reference">
                  <p>PaymentIntent</p>
                  {selected.settlement.providerPaymentId ? (
                    <a
                      href={`https://dashboard.stripe.com/test/payments/${selected.settlement.providerPaymentId}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {selected.settlement.providerPaymentId}
                    </a>
                  ) : (
                    <strong>Awaiting provider ID</strong>
                  )}
                </div>
              </div>
            ) : null}

            <div className="policy-block" id="policy">
              <div className="subhead">
                <div>
                  <h3>Policy evaluation</h3>
                  <p>{selected.evaluation?.policyVersion ?? "Evaluation unavailable"}</p>
                </div>
                <span>{selected.evaluation?.decision.replaceAll("_", " ")}</span>
              </div>
              <ul className="check-list">
                {selected.evaluation?.ruleResults.map((rule) => (
                  <li className="check-row" key={rule.rule}>
                    <span className={`check-mark check-${rule.outcome.toLowerCase()}`}>
                      {rule.outcome === "PASS" ? "✓" : rule.outcome === "REVIEW" ? "!" : "×"}
                    </span>
                    <span>
                      <strong>{rule.rule.replaceAll("_", " ")}</strong>
                      <small>{rule.explanation}</small>
                    </span>
                    <b className={`rule-${rule.outcome.toLowerCase()}`}>{rule.outcome}</b>
                  </li>
                ))}
              </ul>
            </div>

            <div className="decision-footer">
              <p aria-live="polite">
                {notice ??
                  (selected.request.state === "REVIEW_REQUIRED"
                    ? "Policy paused this request for an operator decision."
                    : `Current state: ${stateLabels[selected.request.state]}.`)}
              </p>
              <div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={selected.request.state !== "REVIEW_REQUIRED" || processing}
                  onClick={() => void decide("deny")}
                >
                  Deny
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={selected.request.state !== "REVIEW_REQUIRED" || processing}
                  onClick={() => void decide("approve")}
                >
                  {processing ? "Submitting…" : `Approve ${formatCents(selected.request.amountCents)}`}
                </button>
              </div>
            </div>
          </section>

          <aside className="right-stack">
            <section className="envelope-card">
              <p className="eyebrow">POLICY ENVELOPE</p>
              <h3>RoutePilot limits</h3>
              <div className="budget-total">
                <strong>{formatCents(data.summary.committedCents)}</strong>
                <span>committed today</span>
              </div>
              <div className="budget-track">
                <span
                  className="budget-used"
                  style={{
                    width: `${Math.min(
                      (data.summary.committedCents / data.summary.dailyBudgetCents) *
                        100,
                      100,
                    )}%`,
                  }}
                />
              </div>
              <dl className="budget-rules">
                <div><dt>Automatic approval</dt><dd>Up to {formatCents(data.policy.autoApproveLimitCents)}</dd></div>
                <div><dt>Operator review</dt><dd>Above {formatCents(data.policy.autoApproveLimitCents)}</dd></div>
                <div><dt>Hard stop</dt><dd>Above {formatCents(data.policy.hardStopLimitCents)}</dd></div>
              </dl>
            </section>

            <section className="queue-card" id="requests">
              <div className="subhead">
                <div>
                  <p className="eyebrow">REQUEST QUEUE</p>
                  <h3>Database records</h3>
                </div>
                <span>{data.requests.length} loaded</span>
              </div>
              <div className="queue-list">
                {data.requests.map((item) => (
                  <button
                    className={`queue-row ${item.request.id === selectedId ? "queue-selected" : ""}`}
                    type="button"
                    key={item.request.id}
                    onClick={() => {
                      setSelectedId(item.request.id);
                      setNotice(null);
                    }}
                  >
                    <span className="queue-agent">{item.request.agentId.slice(0, 2).toUpperCase()}</span>
                    <span className="queue-copy">
                      <strong>{item.request.merchant}</strong>
                      <small>{item.request.id.slice(0, 8)} · {item.request.category}</small>
                    </span>
                    <span className="queue-amount">
                      <strong>{formatCents(item.request.amountCents)}</strong>
                      <StatusPill state={item.request.state} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : (
        <section className="empty-state">
          <p className="eyebrow">NO REQUESTS YET</p>
          <h2>Start the machine client.</h2>
          <p>Run <code>npm run demo:agent</code> to submit automatic, review, and denial scenarios.</p>
        </section>
      )}

      <section className="audit-strip" id="audit">
        <div>
          <p className="eyebrow">AUDIT TRAIL</p>
          <h3>Every transition leaves evidence.</h3>
        </div>
        {data.audit.length ? (
          <ol>
            {data.audit.slice(0, 6).map((event) => (
              <li key={event.id}>
                <span>{new Date(event.createdAt).toISOString().slice(11, 19)}</span>
                {event.eventType.replaceAll("_", " ")}
              </li>
            ))}
          </ol>
        ) : (
          <p className="audit-empty">Audit events appear after the agent submits a request.</p>
        )}
      </section>
    </div>
  );
}
