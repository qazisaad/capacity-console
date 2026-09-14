import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Table, Td, fmtTime } from "~/components/ui";
import { getPolicy, updatePolicyFn } from "~/server/functions/monitoring";

export const Route = createFileRoute("/_app/policies")({ loader: () => getPolicy(), component: Policies });

function Policies() {
  const data = Route.useLoaderData();
  const { me } = Route.useRouteContext();
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  if (!data.ok) return <Alert tone="error">{data.error}</Alert>;
  const canEdit = me.role === "owner" || me.role === "admin";
  const policy = data.active.policy;
  return (
    <>
      <PageHeader title="Policies and billing" description="Thresholds and waiting rules are app defaults, not provider facts. Every edit creates a new immutable revision." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card title={`Capacity policy · revision ${data.active.revision}`}>
            {message && <div className="mb-3"><Alert tone={message.tone}>{message.text}</Alert></div>}
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={async event => {
              event.preventDefault(); setMessage(null);
              const form = new FormData(event.currentTarget);
              const result = await updatePolicyFn({ data: { expectedRevision: data.active.revision, policy: {
                threshold_percent: Number(form.get("threshold_percent")), reset_grace_minutes: Number(form.get("reset_grace_minutes")),
                max_observation_age_seconds: Number(form.get("max_observation_age_seconds")), renewal_notice_days: Number(form.get("renewal_notice_days")) } } });
              if (!result.ok) { setMessage({ tone: "error", text: result.error }); return; }
              setMessage({ tone: "success", text: `Saved as revision ${result.revision.revision}.` }); await router.invalidate();
            }}>
              <Field label="Review when usage reaches (%)"><Input name="threshold_percent" type="number" min={1} max={100} step={0.5} defaultValue={policy.threshold_percent} disabled={!canEdit} required /></Field>
              <Field label="Wait if reset is within (minutes)"><Input name="reset_grace_minutes" type="number" min={0} max={1440} defaultValue={policy.reset_grace_minutes} disabled={!canEdit} required /></Field>
              <Field label="Reading is stale after (seconds)"><Input name="max_observation_age_seconds" type="number" min={1} max={86400} defaultValue={policy.max_observation_age_seconds} disabled={!canEdit} required /></Field>
              <Field label="Renewal review window (days)"><Input name="renewal_notice_days" type="number" min={0} max={90} defaultValue={policy.renewal_notice_days} disabled={!canEdit} required /></Field>
              {canEdit && <div className="sm:col-span-2"><Button type="submit">Save as new revision</Button></div>}
            </form>
          </Card>
          <Card title="Revision history">
            <Table head={["Revision", "Threshold", "Grace", "Max age", "Renewal window", "Created"]}>
              {data.history.map(revision => <tr key={revision.revision}><Td>{revision.revision}</Td><Td>{revision.policy.threshold_percent}%</Td><Td>{revision.policy.reset_grace_minutes} min</Td><Td>{revision.policy.max_observation_age_seconds}s</Td><Td>{revision.policy.renewal_notice_days} d</Td><Td>{fmtTime(revision.createdAt)}</Td></tr>)}
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Billing context">
            <p className="text-sm text-stone-600">Quotes, contracts, budgets and connector configuration are not implemented yet. Without verified quotes and a finite budget, every threshold breach asks for human review and nothing is purchased.</p>
          </Card>
          <Card title="Connector readiness">
            <p className="text-sm text-stone-600">Claude Enterprise spend-cap connector: <strong>disabled</strong>. Live administration stays off until the documented verification gate passes with a designated test organization.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
