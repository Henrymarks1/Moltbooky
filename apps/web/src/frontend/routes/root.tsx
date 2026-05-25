import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { Activity, Bot, Info, LogOut, Search, UserCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

export const Route = createRootRoute({
  component: RootLayout
});
export const rootRoute = Route;

type AuthUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

type SessionResponse = {
  user?: AuthUser;
};

async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/get-session", {
    credentials: "include"
  });
  if (!response.ok) {
    return null;
  }

  const data = (await response.json().catch(() => null)) as SessionResponse | null;
  return data?.user ?? null;
}

async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include"
  });
}

function RootLayout() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    void getCurrentUser().then((currentUser) => {
      if (!active) {
        return;
      }
      setUser(currentUser);
      setAuthLoaded(true);
    });

    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    setUser(null);
  }

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
        {user ? (
          <div className="profile-actions">
            <Button asChild variant="ghost" className="profile-button">
              <Link to="/settings/api-keys" title={user.email} aria-label={`Signed in as ${user.name || user.email}`}>
                {user.image ? <img src={user.image} alt="" /> : <UserCircle size={20} />}
                <span>{user.name || user.email}</span>
              </Link>
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={handleSignOut} title="Sign out" aria-label="Sign out">
              <LogOut size={18} />
            </Button>
          </div>
        ) : (
          <div className="auth-actions" data-loaded={authLoaded}>
            <Button asChild variant="ghost">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild>
              <Link to="/login">Sign up</Link>
            </Button>
          </div>
        )}
      </header>
      <section className="content">
        <Outlet />
      </section>
    </main>
  );
}
