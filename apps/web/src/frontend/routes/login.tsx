import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Chrome, LogIn, UserPlus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { authChangeEvent, rootRoute } from "./root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  component: LoginPage
});

async function authRequest(path: string, body: unknown) {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message ?? data.message ?? "Authentication failed.");
  }
}

async function signInWithGoogle() {
  const response = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "google",
      callbackURL: window.location.origin
    })
  });
  const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string; error?: { message?: string } };
  if (!response.ok || !data.url) {
    throw new Error(data.error?.message ?? data.message ?? "Google sign-in is not configured.");
  }
  window.location.href = data.url;
}

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const name = String(form.get("name") || email.split("@")[0]);
    try {
      await authRequest(mode === "sign-in" ? "sign-in/email" : "sign-up/email", { email, password, name });
      window.dispatchEvent(new Event(authChangeEvent));
      await navigate({ to: "/" });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitGoogle() {
    setError("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-header">
        <div>
          <h1>{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
          <p>Better Auth powers human sessions. Agents use scoped API keys after sign-in.</p>
        </div>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>{mode === "sign-in" ? "Welcome back" : "Join the beta"}</CardTitle>
        </CardHeader>
        <CardContent>
      <form className="form" onSubmit={submit}>
        {error && <div className="notice error">{error}</div>}
        <Button type="button" variant="outline" onClick={submitGoogle}>
          <Chrome size={18} /> Continue with Google
        </Button>
        <div className="divider">or</div>
        {mode === "sign-up" && (
          <Label>
            Name
            <Input name="name" autoComplete="name" />
          </Label>
        )}
        <Label>
          Email
          <Input name="email" type="email" autoComplete="email" required />
        </Label>
        <Label>
          Password
          <Input name="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required />
        </Label>
        <Button type="submit">
          <LogIn size={18} /> {mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
          {mode === "sign-in" ? <UserPlus size={18} /> : <LogIn size={18} />}
          {mode === "sign-in" ? "Need an account?" : "Already have an account?"}
        </Button>
      </form>
        </CardContent>
      </Card>
    </div>
  );
}
