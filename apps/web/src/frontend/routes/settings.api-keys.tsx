import { Link, createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createFrontendClient } from "@pipedream/sdk/browser";
import { KeyRound, Link2, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { api, type PipedreamApp, type PipedreamConnection } from "../lib/api";
import { authChangeEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/api-keys",
  component: ApiKeysPage
});

const pinnedConnectionSlugs = ["linkedin", "github", "strava", "slack", "gmail", "google_drive", "google_calendar"];
const noticeClass = "rounded-lg border bg-card p-4 text-sm text-card-foreground";
const noticeErrorClass = "rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive";
const connectionLogoClass =
  "grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-background text-xs font-semibold text-muted-foreground [&_img]:h-6 [&_img]:w-6 [&_img]:object-contain";

function orderedApps(apps: PipedreamApp[]): PipedreamApp[] {
  const appBySlug = new Map(apps.map((app) => [app.nameSlug, app]));
  const pinnedApps = pinnedConnectionSlugs.map((slug) => appBySlug.get(slug)).filter((app): app is PipedreamApp => Boolean(app));
  const pinned = new Set(pinnedApps.map((app) => app.nameSlug));
  return [...pinnedApps, ...apps.filter((app) => !pinned.has(app.nameSlug))];
}

function ApiKeysPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [name, setName] = useState("Research agent");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [connections, setConnections] = useState<PipedreamConnection[]>([]);
  const [pipedreamApps, setPipedreamApps] = useState<PipedreamApp[]>([]);
  const [connectionsError, setConnectionsError] = useState("");
  const [reconnectingSlug, setReconnectingSlug] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [connectionSearch, setConnectionSearch] = useState("");

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

  useEffect(() => {
    if (!user) {
      setConnections([]);
      return;
    }

    let active = true;
    setConnectionsError("");
    api
      .listPipedreamConnections()
      .then(({ connections }) => {
        if (!active) {
          return;
        }
        setConnections(connections);
      })
      .catch((err) => {
        if (active) {
          setConnectionsError((err as Error).message);
        }
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setPipedreamApps([]);
      return;
    }

    let active = true;
    api
      .listPipedreamApps(connectionSearch)
      .then(({ apps }) => {
        if (active) {
          setPipedreamApps(apps);
        }
      })
      .catch((err) => {
        if (active) {
          setConnectionsError((err as Error).message);
        }
      });

    return () => {
      active = false;
    };
  }, [connectionSearch, user]);

  async function createKey() {
    setError("");
    try {
      const result = await api.createApiKey(name);
      setSecret(result.apiKey.secret);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function connectPipedreamApp(app: { appSlug: string; appName: string; authPropName: string }) {
    setConnectionsError("");
    setConnectionStatus("");
    setReconnectingSlug(app.appSlug);
    try {
      const token = await api.createPipedreamConnectToken();
      const client = createFrontendClient({
        externalUserId: token.externalUserId,
        token: token.token,
        tokenCallback: async () => {
          const freshToken = await api.createPipedreamConnectToken();
          return {
            token: freshToken.token,
            expiresAt: freshToken.expiresAt ? new Date(freshToken.expiresAt) : new Date(Date.now() + 3 * 60 * 60 * 1000),
            connectLinkUrl: freshToken.connectLinkUrl ?? ""
          };
        }
      });

      await client.connectAccount({
        app: app.appSlug,
        onSuccess: ({ id }) => {
          void api
            .savePipedreamConnection({
              appSlug: app.appSlug,
              appName: app.appName,
              accountId: id,
              authPropName: app.authPropName
            })
            .then(({ connection: saved }) => {
              setConnections((items) => {
                const existing = items.some((item) => item.appSlug === saved.appSlug);
                return existing ? items.map((item) => (item.appSlug === saved.appSlug ? saved : item)) : [saved, ...items];
              });
              setConnectionStatus(`${app.appName} connected.`);
            })
            .catch((err) => {
              setConnectionsError((err as Error).message);
            });
        },
        onError: (err) => {
          setConnectionsError(err.message);
        },
        onClose: () => {
          setReconnectingSlug("");
        }
      });
    } catch (err) {
      setConnectionsError((err as Error).message);
      setReconnectingSlug("");
    }
  }

  const appImages = new Map(pipedreamApps.map((app) => [app.nameSlug, app.imgSrc]));
  const connectedSlugs = new Set(connections.map((connection) => connection.appSlug));
  const filteredApps = orderedApps(pipedreamApps).slice(0, 18);

  if (!authLoaded) {
    return <div className="mx-auto grid min-h-[420px] max-w-7xl place-items-center gap-6 text-sm font-semibold text-muted-foreground">Checking session...</div>;
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex items-start justify-between gap-4 [&_h1]:max-w-[850px] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-2xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
        <div>
          <h1>Settings</h1>
          <p>Saved connections and scoped keys for agent workflows.</p>
        </div>
      </header>
      {user ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Saved Pipedream connections</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {connectionsError && <div className={noticeErrorClass}>{connectionsError}</div>}
              {connectionStatus && <div className={noticeClass}>{connectionStatus}</div>}
              {connections.length ? (
                <div className="grid gap-2">
                  {connections.map((connection) => (
                    <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-muted/30 p-3 max-[680px]:grid-cols-[40px_minmax(0,1fr)] max-[680px]:[&_button]:col-span-full" key={connection.id}>
                      <span className={connectionLogoClass}>
                        {appImages.get(connection.appSlug) ? <img src={appImages.get(connection.appSlug)} alt="" /> : <Link2 size={18} />}
                      </span>
                      <span className="grid min-w-0 gap-1">
                        <strong className="truncate text-sm font-semibold">{connection.appName}</strong>
                        <small className="truncate text-xs font-medium text-muted-foreground">Saved for future markets</small>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          void connectPipedreamApp({
                            appSlug: connection.appSlug,
                            appName: connection.appName,
                            authPropName: connection.authPropName
                          })
                        }
                        disabled={reconnectingSlug === connection.appSlug}
                      >
                        <RefreshCw size={16} /> {reconnectingSlug === connection.appSlug ? "Reconnecting" : "Reconnect"}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={noticeClass}>No saved Pipedream connections yet.</div>
              )}
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="grid gap-1">
                  <strong className="text-base font-semibold">Add a connection</strong>
                  <small className="text-sm text-muted-foreground">Connect here once, then reuse it while creating markets.</small>
                </div>
                <label className="relative block [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:left-3 [&_svg]:top-1/2 [&_svg]:z-10 [&_svg]:-translate-y-1/2 [&_svg]:text-muted-foreground [&_input]:pl-9">
                  <Search size={16} />
                  <Input
                    value={connectionSearch}
                    onChange={(event) => setConnectionSearch(event.target.value)}
                    placeholder="Search Pipedream apps"
                    type="search"
                  />
                </label>
                <div className="grid grid-cols-3 gap-3 max-[920px]:grid-cols-2 max-[560px]:grid-cols-1">
                  {filteredApps.map((app) => {
                    const connected = connectedSlugs.has(app.nameSlug);
                    return (
                      <button
                        className="grid min-h-[74px] grid-cols-[40px_minmax(0,1fr)_18px] items-center gap-3 rounded-lg border bg-card p-3 text-left text-card-foreground transition-colors hover:border-primary/40 hover:bg-background disabled:cursor-wait disabled:opacity-70"
                        type="button"
                        key={app.id}
                        onClick={() =>
                          void connectPipedreamApp({
                            appSlug: app.nameSlug,
                            appName: app.name,
                            authPropName: app.nameSlug
                          })
                        }
                        disabled={reconnectingSlug === app.nameSlug}
                      >
                        <span className={connectionLogoClass}>
                          {app.imgSrc ? <img src={app.imgSrc} alt="" /> : <Link2 size={18} />}
                        </span>
                        <span className="grid min-w-0 gap-1">
                          <strong className="truncate text-sm font-semibold">{app.name}</strong>
                          <small className="truncate text-xs font-medium text-muted-foreground">{connected ? "Connected" : app.categories?.[0] ?? app.authType ?? "Pipedream app"}</small>
                        </span>
                        {connected ? <RefreshCw size={16} /> : <Plus size={16} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Create a scoped key</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
            {error && <div className={noticeErrorClass}>{error}</div>}
            <Label>
              Key name
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Label>
            <Button onClick={createKey}>
              <KeyRound size={18} /> Create key
            </Button>
            {secret && (
              <div className={`${noticeClass} [&_code]:mt-2 [&_code]:block [&_code]:overflow-auto [&_code]:break-all [&_code]:rounded-md [&_code]:bg-muted [&_code]:p-3 [&_code]:text-sm [&_code]:text-foreground`}>
                <strong>Copy this key now.</strong>
                <code>{secret}</code>
              </div>
            )}
            </CardContent>
          </Card>
        </>
      ) : (
        <section className="grid min-h-[280px] place-items-center gap-3 rounded-lg border bg-card p-5 text-center text-card-foreground [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
          <h2>Sign in required</h2>
          <p>Agent API keys belong to a user account. Testing mode can be enabled without signing in.</p>
          <Button asChild>
            <Link to="/login">Log in</Link>
          </Button>
        </section>
      )}
      <section className="rounded-lg border bg-card p-5 text-card-foreground [&_h2]:inline-flex [&_h2]:items-center [&_h2]:gap-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight">
        <h2><ShieldCheck size={18} /> Default scopes</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">challenges:read</Badge>
          <Badge variant="outline">challenges:create</Badge>
          <Badge variant="outline">matches:create</Badge>
          <Badge variant="outline">credits:read</Badge>
        </div>
      </section>
    </div>
  );
}
