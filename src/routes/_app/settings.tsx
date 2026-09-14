import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, PageHeader } from "~/components/ui";

export const Route = createFileRoute("/_app/settings")({ component: Settings });

function Settings() {
  const { me } = Route.useRouteContext();
  const active = me.organizations.find(org => org.id === me.activeOrganizationId);
  return (
    <>
      <PageHeader title="Organization settings" description="Roles, invitations, provider secrets, retention and disclosure." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Organization"><dl className="grid grid-cols-2 gap-2 text-sm"><dt className="text-stone-500">Name</dt><dd>{active?.name}</dd><dt className="text-stone-500">Slug</dt><dd>{active?.slug}</dd><dt className="text-stone-500">Your role</dt><dd>{me.role}</dd></dl><p className="mt-3 text-sm text-stone-600">Invitations and role changes live under <Link to="/people" className="underline">People and machines</Link>. Ownership transfer keeps one active owner. You can also <Link to="/organizations/new" className="underline">create another organization</Link>.</p></Card>
        <Card title="Provider secrets"><p className="text-sm text-stone-600">No connector configured. Provider administration keys are stored encrypted per organization with a versioned key id and never returned to browsers. This section is enabled with the billing connector gate.</p></Card>
        <Card title="Retention and disclosure"><p className="text-sm text-stone-600">Observation history is retained per source. Retention deletion is an explicit operation and cannot remove unresolved financial evidence. Members can revoke their machines at any time; history stays labelled disconnected.</p></Card>
      </div>
    </>
  );
}
