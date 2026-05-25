import { Link, createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FlaskConical, KeyRound, ShieldCheck } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { api } from "../lib/api";
import { isTestingModeEnabled, setTestingModeEnabled, testingModeChangeEvent } from "../lib/testingMode";
import { authChangeEvent, getCurrentUser, rootRoute, type AuthUser } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/api-keys",
  component: ApiKeysPage
});

function ApiKeysPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [name, setName] = useState("Research agent");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [testingMode, setTestingMode] = useState(isTestingModeEnabled());

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

  async function createKey() {
    setError("");
    try {
      const result = await api.createApiKey(name);
      setSecret(result.apiKey.secret);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!authLoaded) {
    return <div className="page loading-page">Checking session...</div>;
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Testing controls and scoped keys for agent workflows.</p>
        </div>
      </header>
      <Card>
        <CardHeader>
          <div className="section-title">
            <CardTitle>Testing mode</CardTitle>
            <FlaskConical size={20} />
          </div>
        </CardHeader>
        <CardContent className="form">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={testingMode}
              onChange={(event) => {
                setTestingModeEnabled(event.target.checked);
                window.dispatchEvent(new Event(authChangeEvent));
              }}
            />
            <span>
              <strong>Bet with fake money</strong>
              <small>Uses a local play-money wallet, challenges, and matches for testing.</small>
            </span>
          </label>
          {testingMode && <div className="notice">Play-money mode is on. Real wallet balances and Stripe deposits are bypassed in this browser.</div>}
        </CardContent>
      </Card>
      {user ? (
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
