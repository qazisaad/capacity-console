import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "~/components/ui";
import { bootstrap, getInstallationStatus } from "~/server/functions/identity";

export const Route = createFileRoute("/bootstrap")({
  loader: async () => {
    const status = await getInstallationStatus();
    if (status.initialized && !status.bootstrapOpen) throw redirect({ to: "/login" });
    return status;
  },
  component: Bootstrap,
});

function Bootstrap() {
  const status = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto mt-16 w-full max-w-md px-4">
      <h1 className="mb-2 text-center text-2xl font-semibold">Set up Capacity Console</h1>
      <p className="mb-6 text-center text-sm text-stone-600">Create the first administrator with the one-time bootstrap token printed by setup. This form closes permanently afterwards.</p>
      {!status.initialized && <Alert tone="error">No bootstrap token is configured. Run <code>npm run setup</code> and start the app with the generated configuration.</Alert>}
      <Card title="First administrator">
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError(null);
          const form = new FormData(event.currentTarget);
          const result = await bootstrap({ data: { token: String(form.get("token")), email: String(form.get("email")), name: String(form.get("name")), password: String(form.get("password")) } });
          setBusy(false);
          if (!result.ok) { setError(result.error); return; }
          await router.invalidate();
          await router.navigate({ to: "/organizations/new" });
        }}>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Bootstrap token" hint="From the setup output or the private config file. Never shared or logged."><Input name="token" type="password" autoComplete="off" required /></Field>
          <Field label="Your name"><Input name="name" required maxLength={120} /></Field>
          <Field label="Email"><Input name="email" type="email" autoComplete="username" required /></Field>
          <Field label="Password" hint="At least 12 characters."><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
          <Button type="submit" disabled={busy || !status.initialized} className="w-full">{busy ? "Creating…" : "Create administrator"}</Button>
        </form>
      </Card>
    </main>
  );
}
