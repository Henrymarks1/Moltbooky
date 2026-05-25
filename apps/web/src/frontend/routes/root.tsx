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

export const authChangeEvent = "moltbooky-auth-change";

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
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    throw new Error("Sign out failed.");
  }
}

function RootLayout() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;

    async function refreshAuth() {
      const currentUser = await getCurrentUser();
      if (!active) {
        return;
      }
      setUser(currentUser);
      setAuthLoaded(true);
    }

    void refreshAuth();
    window.addEventListener(authChangeEvent, refreshAuth);
    window.addEventListener("focus", refreshAuth);

    return () => {
      active = false;
      window.removeEventListener(authChangeEvent, refreshAuth);
      window.removeEventListener("focus", refreshAuth);
    };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      setUser(await getCurrentUser());
      window.dispatchEvent(new Event(authChangeEvent));
    } catch {
      setUser(await getCurrentUser());
    } finally {
      setSigningOut(false);
    }
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
              aria-label="Sign out"
            >
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
