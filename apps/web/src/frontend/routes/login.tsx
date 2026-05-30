import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
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

function GoogleIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.82-.07-1.6-.2-2.36H12v4.46h6.46a5.52 5.52 0 0 1-2.39 3.62v2.96h3.87c2.27-2.09 3.55-5.17 3.55-8.68Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-2.96c-1.07.72-2.44 1.14-4.07 1.14-3.13 0-5.78-2.11-6.73-4.95H1.29v3.05A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.32A7.2 7.2 0 0 1 4.9 12c0-.8.13-1.58.37-2.32V6.63H1.29A12 12 0 0 0 0 12c0 1.93.46 3.76 1.29 5.37l3.98-3.05Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.73c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.93 1.17 15.23 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.05C6.22 6.84 8.87 4.73 12 4.73Z"
      />
    </svg>
  );
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
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex items-start justify-between gap-4 [&_h1]:max-w-[850px] [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight max-[720px]:[&_h1]:text-2xl [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground">
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
      <form className="grid gap-3" onSubmit={submit}>
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
        <Button type="button" variant="outline" className="relative !h-12 !border-[#dadce0] !bg-white text-[15px] font-semibold !text-[#3c4043] shadow-sm transition-[background-color,border-color,box-shadow] hover:!border-[#d2d5d9] hover:!bg-[#f8fafd] hover:!text-[#202124] focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2" onClick={submitGoogle}>
          <GoogleIcon /> Continue with Google
        </Button>
        <div className="flex items-center gap-3 text-center text-xs font-medium uppercase text-muted-foreground before:h-px before:flex-1 before:bg-border before:content-[''] after:h-px after:flex-1 after:bg-border after:content-['']">or</div>
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
