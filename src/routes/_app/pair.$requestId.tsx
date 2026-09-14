import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Button, Card, Field, PageHeader, Select, fmtTime } from "~/components/ui";
import { approvePairingFn, denyPairingFn, getMembers, getPairing } from "~/server/functions/monitoring";

export const Route = createFileRoute("/_app/pair/$requestId")({
  loader: async ({ params }) => ({ pairing: await getPairing({ data: { requestId: params.requestId } }), members: await getMembers() }),
  component: Pair,
});

function Pair() {
  const { pairing, members } = Route.useLoaderData();
  const { me } = Route.useRouteContext();
  const { requestId } = Route.useParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string>(me.memberId ?? "");
  const [done, setDone] = useState(false);
  if (!pairing.ok) return <Alert tone="error">{pairing.error}</Alert>;
  const request = pairing.request;
  if (!request) return <Alert tone="error">This pairing request does not exist.</Alert>;
  const canOnBehalf = me.role === "owner" || me.role === "admin";
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Approve a machine" description="The machine that printed this link will receive a credential bound to your organization and to the selected member. The code shown in the terminal alone approves nothing." />
      <Card title={request.hostId}>
        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm"><dt className="text-stone-500">Runner id</dt><dd className="truncate">{request.runnerId}</dd><dt className="text-stone-500">Status</dt><dd>{request.status}</dd><dt className="text-stone-500">Expires</dt><dd>{fmtTime(request.expiresAt)}</dd></dl>
        {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
        {done && <Alert tone="success">Approved. The machine will connect within a few seconds and start sharing readings.</Alert>}
        {request.status === "pending" && !done && (
          <div className="space-y-3">
            {canOnBehalf && members.ok && (
              <Field label="Pair for member" hint="Enrolling on behalf of another member is recorded in the audit log.">
                <Select value={memberId} onChange={event => setMemberId(event.target.value)}>{members.members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === me.memberId ? " (you)" : ""}</option>)}</Select>
              </Field>
            )}
            <div className="flex gap-2">
              <Button onClick={async () => { setError(null); const result = await approvePairingFn({ data: { requestId, ...(memberId && memberId !== me.memberId ? { memberId } : {}) } }); if (!result.ok) { setError(result.error); return; } setDone(true); await router.invalidate(); }}>Approve this machine</Button>
              <Button variant="danger" onClick={async () => { const result = await denyPairingFn({ data: { requestId } }); if (!result.ok) { setError(result.error); return; } await router.navigate({ to: "/people" }); }}>Deny</Button>
            </div>
          </div>
        )}
        {request.status !== "pending" && <p className="text-sm text-stone-600">This request is {request.status}. Run the connect command again on the machine to start a new one.</p>}
      </Card>
    </div>
  );
}
