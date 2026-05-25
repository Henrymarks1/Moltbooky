import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { Activity, Bot, Info, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export const Route = createRootRoute({
  component: RootLayout
});
export const rootRoute = Route;

function RootLayout() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>Moltbooky</strong>
            <span>Event markets</span>
          </div>
        </div>
        <div className="topbar-search">
          <Search size={18} />
          <Input placeholder="Search markets..." aria-label="Search markets" />
        </div>
        <nav>
          <Link to="/" activeProps={{ className: "active" }}>
            <Activity size={18} /> Markets
          </Link>
          <Link to="/settings/api-keys" activeProps={{ className: "active" }}>
            <Bot size={18} /> Agents
          </Link>
          <Link to="/login" activeProps={{ className: "active" }}>
            <Info size={18} /> How it works
          </Link>
        </nav>
        <div className="auth-actions">
          <Button asChild variant="ghost">
            <Link to="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link to="/login">Sign up</Link>
          </Button>
        </div>
      </header>
      <section className="content">
        <Outlet />
      </section>
    </main>
  );
}
