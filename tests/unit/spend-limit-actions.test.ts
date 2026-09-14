// Relocated from packages/hcp-management/src/actions.test.ts (tag management-baseline-0.4.0).
// The JSON file store is not relocated; these tests use an in-memory store with the same claim semantics.
// PostgreSQL attempt ownership and crash tests belong to gate 4.
import { describe, expect, test } from "vitest";
import { SpendLimitActionService, claimSpendLimitAction, type SpendLimitAction, type SpendLimitActionRecord, type SpendLimitActionStore, type SpendLimitAdmin, type SpendLimitState } from "~/server/actions/spend-limit";
import { ClaudeEnterpriseAdmin } from "~/server/billing/claude-enterprise";

class MemoryStore implements SpendLimitActionStore {
  records: SpendLimitActionRecord[] = [];
  async claim(record: SpendLimitActionRecord) { const result = claimSpendLimitAction(this.records, record); if (result.claimed) this.records.push(result.record); return result; }
  async get(id: string) { const record = this.records.find(item => item.action.id === id); if (!record) throw new Error("Unknown action."); return structuredClone(record); }
  async settle(record: SpendLimitActionRecord) { this.records = this.records.map(item => item.action.id === record.action.id ? structuredClone(record) : item); }
}

const expected: SpendLimitState = { amount_minor: "1000", currency: "USD", source: "inherited", override_id: null };
const action: SpendLimitAction = { id: "increase-user-period-1", organization_id: "org", user_id: "user_Test", expected,
  desired: { kind: "set", amount_minor: "2000" }, expires_at: "2999-01-01T00:00:00Z" };
const authorization = { actor_id: "admin", organization_id: "org", user_id: "user_Test", maximum_amount_minor: "2000", allow_restore_inherited: false, expires_at: "2999-01-01T00:00:00Z" };

describe("spend-limit action service", () => {
  test("durable action claims prevent duplicate writes and reconcile a lost response", async () => {
    let writes = 0;
    let state: SpendLimitState = { ...expected };
    const admin: SpendLimitAdmin = { organizationId: "org", read: async () => state, apply: async () => {
      writes++; state = { amount_minor: "2000", currency: "USD", source: "user", override_id: "spl_Test" };
      throw new Error("Response lost after applied write.");
    } };
    const store = new MemoryStore();
    const service = new SpendLimitActionService(store, admin);
    expect((await service.execute(action, authorization)).status).toBe("unknown");
    expect((await service.execute(action, authorization)).status).toBe("unknown");
    expect(writes).toBe(1);
    await expect(service.execute({ ...action, id: "another" }, authorization)).rejects.toThrow(/unresolved/);
    await expect(service.execute({ ...action, desired: { kind: "set", amount_minor: "1900" } }, authorization)).rejects.toThrow(/different payload/);
    const recovered = new SpendLimitActionService(store, admin);
    expect((await recovered.reconcile(action.id)).status).toBe("applied");
    expect((await recovered.execute(action, authorization)).status).toBe("applied");
    expect(writes).toBe(1);
  });

  test("preflight changes, authority, budget and expiry prevent writes", async () => {
    let writes = 0;
    const admin: SpendLimitAdmin = { organizationId: "org", read: async () => ({ ...expected, amount_minor: "1500" }), apply: async () => { writes++; } };
    const service = new SpendLimitActionService(new MemoryStore(), admin);
    await expect(service.execute(action, { ...authorization, organization_id: "another" })).rejects.toThrow(/not authorized/);
    await expect(service.execute(action, { ...authorization, maximum_amount_minor: "100" })).rejects.toThrow(/exceeds/);
    await expect(service.execute({ ...action, expires_at: "2020-01-01T00:00:00Z" }, authorization)).rejects.toThrow(/not authorized/);
    expect((await service.execute(action, authorization)).status).toBe("rejected");
    expect(writes).toBe(0);
  });

  test("Claude admin wire contract defaults to read-only, validates identities, and clears an override instead of setting unlimited", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let amount = "1000";
    let isOverride = false;
    const mockFetch: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
      expect(init?.redirect).toBe("error");
      if (init?.method === "POST") {
        amount = (JSON.parse(String(init.body)) as { amount: string }).amount; isOverride = true;
        return Response.json({ type: "spend_limit", id: "spl_Test", scope: { type: "user", user_id: "user_Test" }, amount, currency: "USD", period: "monthly" });
      }
      if (init?.method === "DELETE") { isOverride = false; amount = "1000"; return Response.json({ type: "spend_limit_deleted", id: "spl_Test" }); }
      return Response.json({ data: [{ scope: { type: "user", user_id: "user_Test" }, amount, currency: "USD", period: "monthly", source: { type: isOverride ? "user" : "organization" }, spend_limit_id: "spl_Test", period_to_date_spend: "950.125" }], next_page: null });
    };
    const readOnly = new ClaudeEnterpriseAdmin("org", { apiKey: "test-key", fetch: mockFetch });
    expect(await readOnly.read("user_Test")).toEqual(expected);
    await expect(readOnly.apply(action)).rejects.toThrow(/disabled/);
    const admin = new ClaudeEnterpriseAdmin("org", { apiKey: "test-key", fetch: mockFetch, allowWrites: true });
    const service = new SpendLimitActionService(new MemoryStore(), admin);
    expect((await service.execute(action, authorization)).status).toBe("applied");
    const restore: SpendLimitAction = { ...action, id: "restore-next-period", expected: await admin.read("user_Test"), desired: { kind: "restore_inherited" } };
    expect((await service.execute(restore, { ...authorization, allow_restore_inherited: true })).status).toBe("applied");
    expect(calls.filter(call => call.method === "POST").length).toBe(1);
    expect(calls.filter(call => call.method === "DELETE").length).toBe(1);
    expect(await admin.read("user_Test")).toEqual(expected);
    expect(calls.every(call => call.url.startsWith("https://api.anthropic.com/v1/organizations/spend_limits"))).toBe(true);
  });
});
