import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { api } from "../lib/api";
import { rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings/api-keys",
  component: ApiKeysPage
});

function ApiKeysPage() {
  const [name, setName] = useState("Research agent");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  async function createKey() {
    setError("");
    try {
      const result = await api.createApiKey(name);
      setSecret(result.apiKey.secret);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <div>
          <h1>Agent API keys</h1>
          <p>Scoped keys let agents post and match challenges with user-owned limits.</p>
        </div>
      </header>
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
