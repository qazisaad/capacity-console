import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Button, Card, Field, Input } from "~/components/ui";
import { acceptInvite, getInvitation, getMe, redeem } from "~/server/functions/identity";

export const Route = createFileRoute("/invite/$invitationId")({
  loader: async ({ params }) => ({ invitation: await getInvitation({ data: { invitationId: params.invitationId } }), me: await getMe() }),
  component: Invite,
});

function Invite() {
  const { invitation, me } = Route.useLoaderData();
  const { invitationId } = Route.useParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!invitation) return <main className="mx-auto mt-16 max-w-md px-4"><Alert tone="error">This invitation is not valid or has expired. Ask an administrator for a new link.</Alert></main>;
  const finish = async (result: { ok: boolean; error?: string }) => {
    setBusy(false);
    if (!result.ok) { setError(result.error ?? "Failed."); return; }
    await router.invalidate();
    await router.navigate({ to: "/" });
  };
  return (
    <main className="mx-auto mt-16 w-full max-w-md px-4">
      <h1 className="mb-2 text-center text-2xl font-semibold">Join {invitation.organizationName}</h1>
      <p className="mb-6 text-center text-sm text-stone-600">Invitation for <strong>{invitation.email}</strong> as <strong>{invitation.role}</strong>. Expires {new Date(invitation.expiresAt).toLocaleString()}.</p>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      {me ? (
        <Card title="Accept as the signed-in user">
          {me.user.email.toLowerCase() === invitation.email.toLowerCase()
            ? <Button disabled={busy} onClick={async () => { setBusy(true); await finish(await acceptInvite({ data: { invitationId } })); }}>Accept invitation</Button>
            : <Alert tone="error">You are signed in as {me.user.email}. Sign out and open the link again with the invited account.</Alert>}
        </Card>
      ) : (
        <Card title="Create your account">
          <p className="mb-4 text-sm">Already have an account? <Link className="underline" to="/login" search={{ next: `/invite/${invitationId}` }}>Sign in to accept this invitation</Link>.</p>
          <form className="space-y-4" onSubmit={async event => {
            event.preventDefault(); setBusy(true); setError(null);
            const form = new FormData(event.currentTarget);
            await finish(await redeem({ data: { invitationId, name: String(form.get("name")), password: String(form.get("password")) } }));
          }}>
            <Field label="Email"><Input value={invitation.email} readOnly disabled /></Field>
            <Field label="Your name"><Input name="name" required maxLength={120} /></Field>
            <Field label="Password" hint="At least 12 characters."><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Joining…" : "Join organization"}</Button>
          </form>
        </Card>
      )}
    </main>
  );
}
