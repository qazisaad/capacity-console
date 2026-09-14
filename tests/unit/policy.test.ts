// Relocated from packages/hcp-management/src/policy.test.ts (tag management-baseline-0.4.0); money adapted to minor-unit strings.
import { describe, expect, test } from "vitest";
import type { AccountUsageView } from "@harness-control/protocol";
import { capacityPolicySchema, evaluateCapacity, evaluateRenewal, type CapacityQuote } from "~/server/capacity/policy";
import { evaluateSpendIncrease } from "~/server/billing/spend-policy";

const now = new Date("2026-09-12T10:00:00Z");
const reset = "2026-09-15T00:00:00Z";
const policy = capacityPolicySchema.parse({});
const view: AccountUsageView = {
  account: { key: "a", provider: "codex", scope_source: "operator", label: "Work" },
  observation: { status: "available", observed_at: now.toISOString(), source: "codex_app_server",
    account: { key: "a", provider: "codex", scope_source: "operator", label: "Work" },
    limits: [{ id: "weekly", label: "Weekly", kind: "quota", used_percent: 95, resets_at: reset }],
  }, freshness: "fresh", sources: [{ host_id: "h", provider_instance_id: "p" }],
};
const quote = (id: string, cost: string, kind: CapacityQuote["kind"] = "upgrade"): CapacityQuote => ({
  id, account_key: "a", kind, currency: "USD", incremental_cost_minor: cost, valid_until: "2026-09-13T00:00:00Z",
  coverage: [{ limit_id: "weekly", resets_at: reset }], description: id,
});
const budget = { currency: "USD", account_remaining_minor: "5000", organization_remaining_minor: "10000" };

describe("capacity policy", () => {
  test("95 percent triggers review, not a purchase; comparable costs select the cheapest approved option", () => {
    expect(evaluateCapacity({ view, policy, now }).kind).toBe("review_capacity");
    const result = evaluateCapacity({ view, policy, now, budget, quotes: [quote("upgrade", "3000"), quote("burst", "700", "extra_usage")] });
    expect(result.kind).toBe("recommend_extra_usage");
    expect(result.quote?.id).toBe("burst");
    expect(result.id).toBe(evaluateCapacity({ view, policy, now, budget, quotes: [quote("burst", "700", "extra_usage")] }).id);
  });

  test("missing, failed, stale and reset-passed observations never produce a spend recommendation", () => {
    expect(evaluateCapacity({ view: { ...view, freshness: "unavailable" }, policy, now, budget, quotes: [quote("buy", "1")] }).kind).toBe("refresh");
    expect(evaluateCapacity({ view, policy, now: new Date("2026-09-12T11:00:00Z") }).kind).toBe("refresh");
    for (const limits of [[], [{ id: "weekly", label: "Weekly", kind: "quota" as const }], [{ ...view.observation.limits[0]!, resets_at: now.toISOString() }]]) {
      expect(evaluateCapacity({ view: { ...view, observation: { ...view.observation, limits } }, policy, now }).kind).toBe("refresh");
    }
  });

  test("short reset waits, different currency/window/account quotes and both budgets are respected", () => {
    const near = { ...view, observation: { ...view.observation, limits: [{ ...view.observation.limits[0]!, resets_at: "2026-09-12T10:10:00Z" }] } };
    expect(evaluateCapacity({ view: near, policy, now }).kind).toBe("wait_for_reset");
    const wrong = [{ ...quote("euro", "1"), currency: "EUR" }, { ...quote("other", "1"), account_key: "other" }, { ...quote("old", "1"), coverage: [{ limit_id: "weekly", resets_at: "2026-09-14T00:00:00Z" }] }];
    expect(evaluateCapacity({ view, policy, now, budget, quotes: wrong }).kind).toBe("review_capacity");
    expect(evaluateCapacity({ view, policy, now, budget: { ...budget, organization_remaining_minor: "10" }, quotes: [quote("buy", "20")] }).kind).toBe("budget_exhausted");
  });

  test("money must be exact minor-unit strings; JS numbers are rejected at the boundary", () => {
    expect(() => evaluateCapacity({ view, policy, now, budget: { ...budget, account_remaining_minor: 5000 as unknown as string } })).toThrow();
    const big = evaluateCapacity({ view, policy, now, budget: { currency: "USD", account_remaining_minor: "99999999999999999999", organization_remaining_minor: "99999999999999999999" }, quotes: [quote("huge", "99999999999999999998")] });
    expect(big.kind).toBe("recommend_upgrade");
  });

  test("renewal decisions use actual change deadlines and all-in forecast, not calendar-month resets", () => {
    const contract = { account_key: "a", current_plan: "premium", baseline_plan: "standard", currency: "USD",
      current_next_period_cost_minor: "12000", baseline_next_period_cost_minor: "2500",
      renewal_at: "2027-09-18T00:00:00Z", change_deadline_at: "2027-09-17T00:00:00Z",
    };
    expect(evaluateRenewal(contract, policy, now).kind).toBe("not_due");
    const reviewDate = new Date("2027-09-12T00:00:00Z");
    expect(evaluateRenewal(contract, policy, reviewDate).kind).toBe("review");
    expect(evaluateRenewal({ ...contract, baseline_expected_extra_usage_minor: "1500" }, policy, reviewDate).kind).toBe("recommend_baseline");
    expect(evaluateRenewal({ ...contract, baseline_expected_extra_usage_minor: "15000" }, policy, reviewDate).kind).toBe("keep");
    expect(evaluateRenewal(contract, policy, new Date(contract.change_deadline_at)).kind).toBe("deadline_missed");
  });

  test("spending policies preserve fractional minor-unit precision and never enable disabled usage implicitly", () => {
    const limits = { threshold_percent: 95, increment_minor: "10000", maximum_minor: "60000", organization_remaining_minor: "1000" };
    expect(evaluateSpendIncrease({ amount: "50000", period_to_date_spend: "47499.999" }, limits).kind).toBe("keep");
    expect(evaluateSpendIncrease({ amount: "50000", period_to_date_spend: "47500.001" }, limits)).toEqual({
      kind: "recommend_increase", amount_minor: "51000", reason: "Increase is bounded by the member ceiling and remaining organization budget.",
    });
    expect(evaluateSpendIncrease({ amount: "0", period_to_date_spend: "0" }, limits).kind).toBe("review");
    expect(evaluateSpendIncrease({ amount: null, period_to_date_spend: "900000" }, limits).kind).toBe("keep");
    expect(evaluateSpendIncrease({ amount: "60000", period_to_date_spend: "59000" }, limits).kind).toBe("budget_exhausted");
  });
});
