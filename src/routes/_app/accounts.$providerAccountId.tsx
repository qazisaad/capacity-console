import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Badge, Button, Card, Field, PageHeader, Select, Table, Td, fmtTime, relativeReset } from "~/components/ui";
import { assignAccountFn, getAccount } from "~/server/functions/monitoring";

export const Route = createFileRoute("/_app/accounts/$providerAccountId")({
  loader: ({ params }) => getAccount({ data: { providerAccountId: params.providerAccountId } }),
  component: AccountDetail,
});

function AccountDetail() {
  const data = Route.useLoaderData();
  const { me } = Route.useRouteContext();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!data.ok) return <Alert tone="error">{data.error}</Alert>;
  const canAssign = me.role === "owner" || me.role === "admin";
  return (
    <>
      <PageHeader title={data.account.label} description={`${data.account.provider} · ${data.observation.plan ?? "plan unavailable"} · account key ${data.account.key}`} actions={<Badge tone={data.freshness === "fresh" ? "good" : data.freshness === "stale" ? "warn" : "bad"}>{data.freshness}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`Latest successful observation · ${fmtTime(data.observation.observed_at)}`}>
            <Table head={["Window", "Used", "Reset", "Kind"]}>
              {data.observation.limits.map(limit => <tr key={limit.id}><Td>{limit.label}</Td><Td>{limit.used_percent === undefined ? "Unavailable" : `${limit.used_percent.toFixed(1)}%`}</Td><Td>{relativeReset(limit.resets_at)}<div className="text-xs text-stone-500">{fmtTime(limit.resets_at)}</div></Td><Td>{limit.kind}{limit.window_minutes ? ` · ${limit.window_minutes} min` : ""}</Td></tr>)}
            </Table>
          </Card>
          <Card title="Policy explanation">
            <p className="text-sm"><strong>{data.decision.kind.replaceAll("_", " ")}</strong> · {data.decision.reason}</p>
            <p className="mt-2 text-xs text-stone-500">Evaluated with policy revision {data.policy.revision}. A quota percentage is not invoice spending; recommendations require verified quotes and budgets before any spend can be authorized.</p>
          </Card>
          {data.history.map(source => (
            <Card key={source.sourceId} title={`History · ${source.hostId} / ${source.providerInstanceId}`}>
              <Table head={["Observed", "Received", "Result"]}>
                {source.samples.map(sample => <tr key={sample.observedAt}><Td>{fmtTime(sample.observedAt)}</Td><Td>{fmtTime(sample.receivedAt)}</Td><Td>{sample.observation.status === "available" ? sample.observation.limits.map(limit => `${limit.label} ${limit.used_percent === undefined ? "n/a" : `${limit.used_percent.toFixed(1)}%`}`).join(" · ") : <span className="text-amber-700">unavailable · {sample.observation.reason.replaceAll("_", " ")}</span>}</Td></tr>)}
              </Table>
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          <Card title="Assignment">
            {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
            <p className="mb-3 text-sm text-stone-600">Currently {data.memberName ? <strong>{data.memberName}</strong> : "unassigned"} · {data.assignment?.verification}. Unverified or conflicting associations are monitored but can never authorize billing.</p>
            {canAssign && data.assignment && (
              <form className="space-y-3" onSubmit={async event => {
                event.preventDefault(); setError(null);
                const form = new FormData(event.currentTarget);
                const memberId = String(form.get("memberId")) || null;
                const result = await assignAccountFn({ data: { providerAccountId: data.assignment!.providerAccountId, expectedRevision: data.assignment!.revision, memberId, verification: memberId && form.get("verified") ? "verified" : "unverified" } });
                if (!result.ok) { setError(result.error); return; }
                await router.invalidate();
              }}>
                <Field label="Member"><Select name="memberId" defaultValue={data.assignment.memberId ?? ""}><option value="">Unassigned</option>{data.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verified" defaultChecked={data.assignment.verification === "verified"} /> I confirmed this account belongs to that member</label>
                <Button type="submit">Save assignment</Button>
              </form>
            )}
          </Card>
          <Card title="Sources">
            <ul className="space-y-2 text-sm">{data.sources.map(source => <li key={source.sourceId}><strong>{source.hostId}</strong> / {source.providerInstanceId}<div className="text-xs text-stone-500">latest {source.latestStatus} · received {fmtTime(source.receivedAt)}</div></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
