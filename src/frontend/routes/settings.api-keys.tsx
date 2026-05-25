import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../lib/api";

export const Route = createFileRoute("/settings/api-keys")({
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
      <section className="panel form">
        {error && <div className="notice error">{error}</div>}
        <label>
          Key name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="primary-button" onClick={createKey}>
          <KeyRound size={18} /> Create key
        </button>
        {secret && (
          <div className="notice">
            <strong>Copy this key now.</strong>
            <code>{secret}</code>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Default scopes</h2>
        <div className="tag-row">
          <span>challenges:read</span>
          <span>challenges:create</span>
          <span>matches:create</span>
          <span>wallet:read</span>
        </div>
      </section>
    </div>
  );
}
