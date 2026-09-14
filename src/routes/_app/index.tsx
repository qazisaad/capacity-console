import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Alert, Badge, Card, Empty, PageHeader, Stat, fmtTime, relativeReset } from "~/components/ui";
import { getOverview } from "~/server/functions/monitoring";

export const Route = createFileRoute("/_app/")({
  loader: () => getOverview(),
  component: Overview,
});

const decisionLabel: Record<string, string> = { healthy: "Capacity available", refresh: "Fresh reading needed", wait_for_reset: "Wait for reset", review_capacity: "Review capacity", recommend_extra_usage: "Extra usage recommended", recommend_upgrade: "Upgrade recommended", budget_exhausted: "Budget exception needed" };
const decisionTone = (kind: string) => kind === "healthy" ? "good" : kind === "refresh" ? "neutral" : kind === "wait_for_reset" ? "info" : "warn";
const freshnessTone = (value: string) => value === "fresh" ? "good" : value === "stale" ? "warn" : "bad";

function Overview() {
  const initial = Route.useLoaderData();
  const { data } = useQuery({ queryKey: ["overview"], queryFn: () => getOverview(), initialData: initial, refetchInterval: 15_000 });
  if (!data.ok) return <Alert tone="error">{data.error}</Alert>;
  const needsReview = data.accounts.filter(account => !["healthy", "refresh"].includes(account.decision.kind));
  const stale = data.accounts.filter(account => account.freshness !== "fresh");
  return (
    <>
      <PageHeader title="Overview" description={`Policy revision ${data.policy.revision}: review at ${data.policy.policy.threshold_percent}% used, wait if the reset is within ${data.policy.policy.reset_grace_minutes} minutes, readings older than ${data.policy.policy.max_observation_age_seconds}s are stale.`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Observed accounts" value={data.accounts.length} />
        <Stat label="Needing review" value={needsReview.length} hint="Threshold reached outside the reset grace" />
        <Stat label="Stale or unavailable" value={stale.length + data.unavailableSources.length} hint="Sources without a fresh successful reading" />
        <Stat label="Authorized exposure" value="—" hint="No billing connector enabled; spending automation is off" />
      </div>
      <Card title="Accounts">
        {!data.accounts.length && <Empty>No account readings yet. Pair a machine under People and machines, enable account usage sharing on it, and readings appear here within a minute.</Empty>}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.accounts.map(account => (
            <article key={account.account.key} className="rounded-lg border border-stone-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{account.assignment ? <Link to="/accounts/$providerAccountId" params={{ providerAccountId: account.assignment.providerAccountId }} className="hover:underline">{account.account.label}</Link> : account.account.label}</h3>
                  <p className="text-xs text-stone-500">{account.observation.plan ?? "Plan unavailable"} · {account.account.provider} · {account.memberName ?? "Unassigned"}{account.assignment?.verification === "verified" ? " · verified" : account.assignment?.verification === "conflict" ? " · conflict" : ""}</p>
                </div>
                <Badge tone={freshnessTone(account.freshness)}>{account.freshness}</Badge>
              </div>
              <ul className="mt-3 space-y-2">
                {account.observation.limits.map(limit => (
                  <li key={limit.id} className="text-sm">
                    <div className="flex justify-between"><span className="text-stone-600">{limit.label}</span><strong>{limit.used_percent === undefined ? "Unavailable" : `${limit.used_percent.toFixed(1)}% used`}</strong></div>
                    {limit.used_percent !== undefined && <progress className="h-1.5 w-full" max={100} value={Math.min(100, limit.used_percent)} aria-label={`${limit.label} consumed`} />}
                    <div className="flex justify-between text-xs text-stone-500"><span>{relativeReset(limit.resets_at)}</span><span>{limit.window_minutes ? `${limit.window_minutes >= 1440 ? `${Math.round(limit.window_minutes / 1440)} day` : `${(limit.window_minutes / 60).toFixed(1)} hour`} window` : limit.kind}</span></div>
                  </li>
                ))}
                {!account.observation.limits.length && <li className="text-sm text-stone-500">The provider returned no quota windows.</li>}
              </ul>
              <div className="mt-3 rounded-md bg-stone-50 p-2 text-xs"><Badge tone={decisionTone(account.decision.kind)}>{decisionLabel[account.decision.kind] ?? account.decision.kind}</Badge><p className="mt-1 text-stone-600">{account.decision.reason}</p></div>
              <p className="mt-2 text-xs text-stone-500">{account.sources.length} source{account.sources.length === 1 ? "" : "s"} · observed {fmtTime(account.observation.observed_at)}</p>
            </article>
          ))}
        </div>
      </Card>
      {data.unavailableSources.length > 0 && (
        <Card title="Sources without a successful reading" className="mt-6">
          <ul className="divide-y divide-stone-100 text-sm">
            {data.unavailableSources.map(source => <li key={source.sourceId} className="py-2"><strong>{source.hostId} / {source.providerInstanceId}</strong> · {source.unavailableReason?.replaceAll("_", " ")}<div className="text-xs text-stone-500">{source.unavailableMessage} · received {fmtTime(source.receivedAt)}</div></li>)}
          </ul>
        </Card>
      )}
    </>
  );
}
