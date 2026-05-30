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
    return <div className="page loading-page">Checking session...</div>;
  }

  return (
    <div className="page narrow">
      <header className="page-header">
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
            <CardContent className="form">
              {connectionsError && <div className="notice error">{connectionsError}</div>}
              {connectionStatus && <div className="notice">{connectionStatus}</div>}
              {connections.length ? (
                <div className="connection-list">
                  {connections.map((connection) => (
                    <div className="connection-row" key={connection.id}>
                      <span className="connection-logo">
                        {appImages.get(connection.appSlug) ? <img src={appImages.get(connection.appSlug)} alt="" /> : <Link2 size={18} />}
                      </span>
                      <span>
                        <strong>{connection.appName}</strong>
                        <small>Saved for future markets</small>
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
                <div className="notice">No saved Pipedream connections yet.</div>
              )}
              <div className="connection-add">
                <div className="connection-add-header">
                  <strong>Add a connection</strong>
                  <small>Connect here once, then reuse it while creating markets.</small>
                </div>
                <label className="settings-search">
                  <Search size={16} />
                  <Input
                    value={connectionSearch}
                    onChange={(event) => setConnectionSearch(event.target.value)}
                    placeholder="Search Pipedream apps"
                    type="search"
                  />
                </label>
                <div className="connection-app-grid">
                  {filteredApps.map((app) => {
                    const connected = connectedSlugs.has(app.nameSlug);
                    return (
                      <button
                        className="connection-app-card"
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
                        <span className="connection-logo">
                          {app.imgSrc ? <img src={app.imgSrc} alt="" /> : <Link2 size={18} />}
                        </span>
                        <span>
                          <strong>{app.name}</strong>
                          <small>{connected ? "Connected" : app.categories?.[0] ?? app.authType ?? "Pipedream app"}</small>
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
            <CardContent className="form">
            {error && <div className="notice error">{error}</div>}
            <Label>
              Key name
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Label>
            <Button onClick={createKey}>
              <KeyRound size={18} /> Create key
            </Button>
            {secret && (
              <div className="notice">
                <strong>Copy this key now.</strong>
                <code>{secret}</code>
              </div>
            )}
            </CardContent>
          </Card>
        </>
      ) : (
        <section className="empty-state">
          <h2>Sign in required</h2>
          <p>Agent API keys belong to a user account. Testing mode can be enabled without signing in.</p>
          <Button asChild>
            <Link to="/login">Log in</Link>
          </Button>
        </section>
      )}
      <section className="panel">
        <h2><ShieldCheck size={18} /> Default scopes</h2>
        <div className="tag-row">
          <Badge variant="outline">challenges:read</Badge>
          <Badge variant="outline">challenges:create</Badge>
          <Badge variant="outline">matches:create</Badge>
          <Badge variant="outline">wallet:read</Badge>
        </div>
      </section>
    </div>
  );
}
