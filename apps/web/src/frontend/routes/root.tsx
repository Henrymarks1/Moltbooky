import { Link, Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { Activity, ChevronDown, Coins, ListChecks, LogOut, Settings, UserCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { capturePageview, identifyAnalyticsUser, resetAnalyticsUser } from "../lib/analytics";
import { cn } from "../lib/utils";
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

  try {
    const response = await fetch("/api/auth/get-session", {
      credentials: "include"
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json().catch(() => null)) as SessionResponse | null;
    return data?.user ?? null;
  } catch {
    return null;
  }
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
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60 max-[720px]:px-4">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center gap-3 max-[720px]:grid max-[720px]:grid-cols-[minmax(0,1fr)_auto] max-[720px]:gap-3 max-[720px]:py-3 [&_nav]:max-[720px]:col-span-full [&_nav]:max-[720px]:w-full [&_nav_a]:max-[720px]:h-9">
          <div className="flex min-w-0 items-center gap-2 no-underline">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">M</div>
            <div>
              <strong className="block text-sm font-semibold leading-tight">Moltbooky</strong>
              <span className="block text-xs font-semibold text-muted-foreground">{testingMode ? "Testing credits" : "Event bets"}</span>
            </div>
          </div>
          <nav className={cn("flex items-center gap-1 overflow-x-auto", pathname === "/" && "hidden")}>
            <Link
              to="/"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground"
              activeProps={{ className: "bg-muted text-foreground hover:bg-muted" }}
            >
              <Activity size={18} /> Bets
            </Link>
            {user && (
              <Link
                to="/my-bets"
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-muted text-foreground hover:bg-muted" }}
              >
                <ListChecks size={18} /> My bets
              </Link>
            )}
          </nav>
          {!authLoaded ? (
            <div className="ml-auto flex min-w-[178px] items-center justify-end gap-2 max-[720px]:col-span-full max-[720px]:grid max-[720px]:grid-cols-1" aria-label="Checking session">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-24" />
            </div>
          ) : user ? (
            <div className="relative ml-auto flex min-w-0 items-center gap-2 max-[720px]:col-span-full max-[720px]:w-full max-[720px]:justify-stretch">
              <Button
                type="button"
                variant="ghost"
                className="max-w-[240px] px-2 max-[720px]:min-w-0 max-[720px]:flex-1 max-[720px]:justify-start [&_img]:h-6 [&_img]:w-6 [&_img]:rounded-full [&_img]:object-cover [&_span]:truncate"
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
                <div className="absolute right-0 top-[calc(100%+8px)] z-30 grid min-w-48 overflow-hidden rounded-lg border bg-card p-1 text-card-foreground shadow-lg [&_a]:flex [&_a]:h-10 [&_a]:w-full [&_a]:items-center [&_a]:gap-2 [&_a]:rounded-md [&_a]:px-3 [&_a]:text-sm [&_a]:font-medium [&_a]:text-foreground [&_a]:no-underline hover:[&_a]:bg-muted [&_button]:flex [&_button]:h-10 [&_button]:w-full [&_button]:items-center [&_button]:gap-2 [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-3 [&_button]:text-left [&_button]:text-sm [&_button]:font-medium [&_button]:text-foreground hover:[&_button]:bg-muted disabled:[&_button]:pointer-events-none disabled:[&_button]:opacity-50" role="menu">
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
            <div className="ml-auto flex items-center gap-2 max-[720px]:col-span-full max-[720px]:grid max-[720px]:grid-cols-1">
              <Button asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          )}
        </div>
      </header>
      <section className={cn("px-6 py-5 max-[720px]:px-4", pathname === "/" && "py-0")}>
        <Outlet />
      </section>
    </main>
  );
}
