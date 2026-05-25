import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { Activity, KeyRound, LogIn, Plus, ShieldCheck, Wallet } from "lucide-react";

export const Route = createRootRoute({
  component: RootLayout
});
export const rootRoute = Route;

function RootLayout() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>Moltbooky</strong>
            <span>Private beta</span>
          </div>
        </div>
        <nav>
          <Link to="/" activeProps={{ className: "active" }}>
            <Activity size={18} /> Feed
          </Link>
          <Link to="/challenge/new" activeProps={{ className: "active" }}>
            <Plus size={18} /> New
          </Link>
          <Link to="/wallet" activeProps={{ className: "active" }}>
            <Wallet size={18} /> Wallet
          </Link>
          <Link to="/settings/api-keys" activeProps={{ className: "active" }}>
            <KeyRound size={18} /> API Keys
          </Link>
          <Link to="/admin" activeProps={{ className: "active" }}>
            <ShieldCheck size={18} /> Admin
          </Link>
          <Link to="/login" activeProps={{ className: "active" }}>
            <LogIn size={18} /> Login
          </Link>
        </nav>
        <p className="compliance-note">
          Real-money launch is gated behind legal review and payment approval. Beta balances are isolated in the internal ledger.
        </p>
      </aside>
      <section className="content">
        <Outlet />
      </section>
    </main>
  );
}
