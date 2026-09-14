import { createFileRoute } from "@tanstack/react-router";
import { Alert, Card, Empty, PageHeader, Table, Td, fmtTime } from "~/components/ui";
import { getAudit } from "~/server/functions/monitoring";

export const Route = createFileRoute("/_app/audit")({ loader: () => getAudit(), component: Audit });

function Audit() {
  const data = Route.useLoaderData();
  return (
    <>
      <PageHeader title="Actions and audit" description="Policy changes, approvals, pairing and assignment events. No financial actions have been proposed or executed in this installation." />
      <Card title="Proposed and executed actions"><Empty>No actions. Spend-cap actions require an enabled connector, a verified billing context and an owner-granted budget.</Empty></Card>
      <Card title="Audit events" className="mt-6">
        {!data.ok && <Alert tone="error">{data.error}</Alert>}
        {data.ok && !data.events.length && <Empty>No events yet.</Empty>}
        {data.ok && data.events.length > 0 && (
          <Table head={["When", "Event", "Subject", "Actor", "Details"]}>
            {data.events.map(event => <tr key={event.id}><Td className="whitespace-nowrap">{fmtTime(event.createdAt)}</Td><Td>{event.kind}</Td><Td>{event.subjectType} <span className="text-xs text-stone-500">{event.subjectId}</span></Td><Td>{event.actorName ?? "system"}</Td><Td><code className="text-xs">{JSON.stringify(event.details)}</code></Td></tr>)}
          </Table>
        )}
      </Card>
    </>
  );
}
