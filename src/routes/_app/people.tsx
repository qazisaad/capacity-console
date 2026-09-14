import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, fmtTime } from "~/components/ui";
import { invite } from "~/server/functions/identity";
import { getMembers, getRunners, refreshRunnerFn, revokeRunnerFn } from "~/server/functions/monitoring";

export const Route = createFileRoute("/_app/people")({
  loader: async () => ({ runners: await getRunners(), members: await getMembers() }),
  component: People,
});

function People() {
  const initial = Route.useLoaderData();
  const { me } = Route.useRouteContext();
  const router = useRouter();
  const runners = useQuery({ queryKey: ["runners"], queryFn: () => getRunners(), initialData: initial.runners, refetchInterval: 10_000 });
  const [inviteResult, setInviteResult] = useState<{ link: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const canManage = me.role === "owner" || me.role === "admin";
  const members = initial.members.ok ? initial.members.members : [];
  return (
    <>
      <PageHeader title="People and machines" description="Memberships, connected machines and provider accounts. Members see only their own machines." />
      {message && <div className="mb-4"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Machines" actions={<span className="text-xs text-stone-500">Pair a machine: <code>hcp-runner connect {typeof window === "undefined" ? "" : window.location.origin}/runner</code></span>}>
            {runners.data.ok && !runners.data.runners.length && <Empty>No machines paired yet. Run the connect command on a machine, then approve it from the link it prints.</Empty>}
            {runners.data.ok && runners.data.runners.length > 0 && (
              <Table head={["Machine", "Member", "Status", "Last seen", "Sources", ""]}>
                {runners.data.runners.map(runner => (
                  <tr key={runner.id}>
                    <Td><div className="font-medium">{runner.hostId}</div><div className="text-xs text-stone-500">{runner.runnerId}</div></Td>
                    <Td>{runner.memberName}</Td>
                    <Td>{runner.revokedAt ? <Badge tone="bad">revoked</Badge> : runner.connected ? <Badge tone="good">connected</Badge> : <Badge tone="warn">offline</Badge>}{runner.connected && !runner.accountUsage && <div className="text-xs text-amber-700">Account usage not enabled on this machine</div>}{runner.lastError && <div className="text-xs text-red-700">{runner.lastError}</div>}</Td>
                    <Td>{fmtTime(runner.lastSeenAt)}{runner.lastReadAt && <div className="text-xs text-stone-500">read {fmtTime(runner.lastReadAt)}</div>}</Td>
                    <Td>{runner.sourceCount}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {!runner.revokedAt && (me.memberId === runner.memberId || canManage) && (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" disabled={!runner.connected} onClick={async () => { const result = await refreshRunnerFn({ data: { runnerRowId: runner.id } }); setMessage(result.ok ? { tone: result.refreshed ? "success" : "error", text: result.message } : { tone: "error", text: result.error }); await runners.refetch(); }}>Refresh</Button>
                          <Button variant="danger" onClick={async () => { if (!confirm(`Revoke ${runner.hostId}? Its credential stops working immediately; history is kept.`)) return; const result = await revokeRunnerFn({ data: { runnerRowId: runner.id, expectedGeneration: runner.generation } }); setMessage(result.ok ? { tone: "success", text: "Machine revoked." } : { tone: "error", text: result.error }); await runners.refetch(); }}>Revoke</Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            {!runners.data.ok && <Alert tone="error">{runners.data.error}</Alert>}
          </Card>
          <Card title="Members">
            <Table head={["Name", "Email", "Role", "Joined"]}>
              {members.map(member => <tr key={member.id}><Td>{member.name}</Td><Td>{member.email ?? "—"}</Td><Td><Badge>{member.role}</Badge></Td><Td>{fmtTime(member.createdAt)}</Td></tr>)}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          {canManage && (
            <Card title="Invite a member">
              <form className="space-y-3" onSubmit={async event => {
                event.preventDefault(); setInviteResult(null); setMessage(null);
                const form = new FormData(event.currentTarget);
                const result = await invite({ data: { email: String(form.get("email")), role: String(form.get("role")) as "admin" | "member" | "auditor" } });
                if (!result.ok) { setMessage({ tone: "error", text: result.error }); return; }
                setInviteResult({ link: result.link, expiresAt: result.expiresAt }); (event.target as HTMLFormElement).reset(); await router.invalidate();
              }}>
                <Field label="Email"><Input name="email" type="email" required /></Field>
                <Field label="Role" hint="Members see their own machines. Admins manage membership and assignments. Auditors read everything except secrets."><Select name="role" defaultValue="member"><option value="member">member</option><option value="admin">admin</option><option value="auditor">auditor</option></Select></Field>
                <Button type="submit">Create invitation link</Button>
              </form>
              {inviteResult && <div className="mt-3 space-y-1 text-xs"><Alert tone="success">Send this link to the invitee. It is single-use and expires {fmtTime(inviteResult.expiresAt)}.</Alert><Input readOnly value={inviteResult.link} onFocus={event => event.currentTarget.select()} /></div>}
            </Card>
          )}
          <Card title="Account usage disclosure">
            <p className="text-sm text-stone-600">Machines share only normalized account quota observations: provider, plan label, per-window used percentage and reset time, plus a pseudonymous account key. No prompts, transcripts, emails or credentials leave the machine. Sharing is opt-in per provider in the runner configuration and can be revoked here at any time.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
