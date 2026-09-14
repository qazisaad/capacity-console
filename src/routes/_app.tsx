import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Button, Select } from "~/components/ui";
import { meQuery } from "~/lib/session";
import { getInstallationStatus, selectOrg, signOut } from "~/server/functions/identity";

/** Authenticated layout: every child route resolves the session server-side before rendering. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    if (!me) {
      const status = await getInstallationStatus();
      throw redirect(!status.initialized || status.bootstrapOpen ? { to: "/bootstrap" } : { to: "/login", search: { next: location.href } });
    }
    if (!me.activeOrganizationId && location.pathname !== "/organizations/new") throw redirect({ to: "/organizations/new" });
    return { me };
  },
  component: AppLayout,
});

const nav = [
  { to: "/", label: "Overview" },
  { to: "/people", label: "People and machines" },
  { to: "/policies", label: "Policies and billing" },
  { to: "/audit", label: "Actions and audit" },
  { to: "/settings", label: "Organization settings" },
] as const;

function AppLayout() {
  const { me } = Route.useRouteContext();
  const router = useRouter();
  const active = me.organizations.find(org => org.id === me.activeOrganizationId);
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-stone-200 bg-white md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Link to="/" className="text-lg font-semibold tracking-tight">Capacity Console</Link>
          {active && <div className="mt-1 hidden text-xs text-stone-500 md:block">{active.name} · {me.role}</div>}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
          {nav.map(item => <Link key={item.to} to={item.to} activeOptions={{ exact: item.to === "/" }} className="rounded-md px-3 py-2 text-sm text-stone-700 hover:bg-stone-100 whitespace-nowrap" activeProps={{ className: "bg-stone-100 font-medium" }}>{item.label}</Link>)}
        </nav>
        <div className="space-y-2 border-t border-stone-200 px-4 py-3 text-sm">
          {me.organizations.length > 1 && (
            <Select value={me.activeOrganizationId ?? ""} onChange={async event => { await selectOrg({ data: { organizationId: event.target.value } }); await router.invalidate(); }}>
              {me.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </Select>
          )}
          <div className="truncate text-xs text-stone-500">{me.user.email}</div>
          <Button variant="ghost" className="px-0 text-xs" onClick={async () => { await signOut(); await router.invalidate(); await router.navigate({ to: "/login" }); }}>Sign out</Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8"><Outlet /></main>
    </div>
  );
}
