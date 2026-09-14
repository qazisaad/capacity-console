import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Alert, Button, Card, Field, Input } from "~/components/ui";
import { getInstallationStatus, getMe, signIn } from "~/server/functions/identity";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ next: z.string().optional() }),
  beforeLoad: async () => {
    const status = await getInstallationStatus();
    if (!status.initialized || status.bootstrapOpen) throw redirect({ to: "/bootstrap" });
    if (await getMe()) throw redirect({ to: "/" });
  },
  component: Login,
});

function Login() {
  const router = useRouter();
  const { next } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto mt-16 w-full max-w-md px-4">
      <h1 className="mb-6 text-center text-2xl font-semibold">Capacity Console</h1>
      <Card title="Sign in">
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError(null);
          const form = new FormData(event.currentTarget);
          const result = await signIn({ data: { email: String(form.get("email")), password: String(form.get("password")) } });
          setBusy(false);
          if (!result.ok) { setError(result.error); return; }
          await router.invalidate();
          await router.navigate({ to: next && next.startsWith("/") ? next : "/" });
        }}>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email"><Input name="email" type="email" autoComplete="username" required /></Field>
          <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
          <p className="text-xs text-stone-500">Accounts are created by invitation only. Ask an administrator for a link if you do not have one.</p>
        </form>
      </Card>
    </main>
  );
}
