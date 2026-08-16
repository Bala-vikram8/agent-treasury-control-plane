import { getDashboardData } from "@/lib/db/queries";
import { requireOperatorPage } from "@/lib/auth";
import { logout } from "./login/actions";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DashboardPage() {
  const operator = await requireOperatorPage();
  const data = await getDashboardData();

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <div>
          <div className="brand">
            <span className="brand-mark">AT</span>
            <span>
              <strong>ATLAS</strong>
              <small>Treasury Control</small>
            </span>
          </div>
          <nav className="primary-nav" aria-label="Primary navigation">
            <a className="nav-item nav-active" href="#overview">
              <span>OV</span>Overview
            </a>
            <a className="nav-item" href="#requests">
              <span>PR</span>Payment requests
              <b>{data.summary.pendingCount}</b>
            </a>
            <a className="nav-item" href="#policy">
              <span>PS</span>Policy evaluation
            </a>
            <a className="nav-item" href="#audit">
              <span>AL</span>Audit trail
            </a>
          </nav>
        </div>
        <div className="rail-footer">
          <div className="system-status">
            <i />
            <span>
              <strong>Postgres connected</strong>
              <small>{data.policy.version}</small>
            </span>
          </div>
          <p>Stripe sandbox only. No real funds.</p>
        </div>
      </aside>

      <section className="workspace" id="overview">
        <header className="topbar">
          <div>
            <p>Workspace</p>
            <strong>Northstar Logistics</strong>
          </div>
          <div className="topbar-actions">
            <span className="sandbox-pill"><i /> Stripe sandbox</span>
            <form action={logout}>
              <button className="operator-button" type="submit" title="Sign out">
                {operator.actorId.slice(0, 2).toUpperCase()}
              </button>
            </form>
          </div>
        </header>
        <DashboardClient data={data} />
      </section>
    </main>
  );
}
