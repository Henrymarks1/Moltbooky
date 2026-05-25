import { Link, Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { Activity, ChevronDown, Coins, Info, ListChecks, LogOut, Search, Settings, UserCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { capturePageview, identifyAnalyticsUser, resetAnalyticsUser } from "../lib/analytics";
import { seoForPath, setSeoMeta } from "../lib/seo";
import { isTestingModeEnabled, testingModeChangeEvent, testingUser } from "../lib/testingMode";

export const Route = createRootRoute({
  component: RootLayout
});
export const rootRoute = Route;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

type SessionResponse = {
  user?: AuthUser;
};

export const authChangeEvent = "moltbooky-auth-change";

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isTestingModeEnabled()) {
    return testingUser;
  }

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
  const href = useRouterState({ select: (state) => state.location.href });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [testingMode, setTestingMode] = useState(isTestingModeEnabled());
  const previousUserId = useRef<string | null>(null);

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
    window.addEventListener(testingModeChangeEvent, refreshAuth);
    window.addEventListener("focus", refreshAuth);

    return () => {
      active = false;
      window.removeEventListener(authChangeEvent, refreshAuth);
      window.removeEventListener(testingModeChangeEvent, refreshAuth);
      window.removeEventListener("focus", refreshAuth);
    };
  }, []);

  useEffect(() => {
    function refreshTestingMode() {
      setTestingMode(isTestingModeEnabled());
    }

    window.addEventListener(testingModeChangeEvent, refreshTestingMode);
    window.addEventListener("storage", refreshTestingMode);
    return () => {
      window.removeEventListener(testingModeChangeEvent, refreshTestingMode);
      window.removeEventListener("storage", refreshTestingMode);
    };
  }, []);

  useEffect(() => {
    capturePageview();
  }, [href]);

  useEffect(() => {
    setSeoMeta(seoForPath(pathname));
  }, [pathname]);

  useEffect(() => {
    if (!authLoaded) {
      return;
    }

    if (user) {
      identifyAnalyticsUser(user);
      previousUserId.current = user.id;
      return;
    }

    if (previousUserId.current) {
      resetAnalyticsUser();
      previousUserId.current = null;
    }
  }, [authLoaded, user]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      setUser(await getCurrentUser());
      setProfileOpen(false);
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
        <div className="topbar-inner">
          <div className="brand">
            <div className="brand-mark">M</div>
            <div>
              <strong>Moltbooky</strong>
              <span>{testingMode ? "Testing credits" : "Event markets"}</span>
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
            <Link to="/my-bets" activeProps={{ className: "active" }}>
              <ListChecks size={18} /> My bets
            </Link>
            <Link to="/credits" activeProps={{ className: "active" }}>
              <Coins size={18} /> Credits
            </Link>
            <Link to="/how-it-works" activeProps={{ className: "active" }}>
              <Info size={18} /> How it works
            </Link>
          </nav>
          {!authLoaded ? (
            <div className="auth-actions auth-actions-pending" aria-label="Checking session">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-24" />
            </div>
          ) : user ? (
            <div className="profile-actions">
              <Button
                type="button"
                variant="ghost"
                className="profile-button"
                onClick={() => setProfileOpen((open) => !open)}
                title={user.email}
                aria-expanded={profileOpen}
                aria-haspopup="menu"
              >
                {user.image ? <img src={user.image} alt="" /> : <UserCircle size={20} />}
                <span>{user.name || user.email}</span>
                <ChevronDown size={16} />
              </Button>
              {profileOpen && (
                <div className="profile-menu" role="menu">
                  <Link to="/my-bets" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <ListChecks size={16} /> My bets
                  </Link>
                  <Link to="/credits" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <Coins size={16} /> Credits
                  </Link>
                  <Link to="/settings/api-keys" role="menuitem" onClick={() => setProfileOpen(false)}>
                    <Settings size={16} /> Settings
                  </Link>
                  <button type="button" role="menuitem" onClick={handleSignOut} disabled={signingOut}>
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="auth-actions">
              <Button asChild variant="ghost">
                <Link to="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link to="/login">Sign up</Link>
              </Button>
            </div>
          )}
        </div>
      </header>
      <section className="content">
        <Outlet />
      </section>
    </main>
  );
}
