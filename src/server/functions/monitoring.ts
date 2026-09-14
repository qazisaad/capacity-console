import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePrincipal } from "../auth/session";
import { approvePairing, denyPairing, getPairingRequestForApproval } from "../hcp/pairing";
import { accountDetail, assignAccount, assignInputSchema, listAudit, listMembers, listRunners, overview, refreshRunner, revokeInputSchema, revokeRunner } from "../monitoring";
import { activePolicy, policyHistory, updatePolicy, updatePolicyInputSchema } from "../capacity/policies";
import { attempt, requestHeaders } from "./_shared";

export const getOverview = createServerFn({ method: "GET" }).handler(() => attempt(async () => overview(await requirePrincipal(requestHeaders()))));
export const getRunners = createServerFn({ method: "GET" }).handler(() => attempt(async () => ({ runners: await listRunners(await requirePrincipal(requestHeaders())) })));
export const getMembers = createServerFn({ method: "GET" }).handler(() => attempt(async () => ({ members: await listMembers(await requirePrincipal(requestHeaders())) })));
export const getAccount = createServerFn({ method: "GET" }).inputValidator(z.object({ providerAccountId: z.string().min(1) }))
  .handler(({ data }) => attempt(async () => accountDetail(await requirePrincipal(requestHeaders()), data.providerAccountId)));
export const getAudit = createServerFn({ method: "GET" }).handler(() => attempt(async () => ({ events: await listAudit(await requirePrincipal(requestHeaders())) })));

export const getPairing = createServerFn({ method: "GET" }).inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(({ data }) => attempt(async () => { await requirePrincipal(requestHeaders()); return { request: await getPairingRequestForApproval(data.requestId) }; }));
export const approvePairingFn = createServerFn({ method: "POST" }).inputValidator(z.object({ requestId: z.string().min(1), memberId: z.string().min(1).optional() }))
  .handler(({ data }) => attempt(async () => approvePairing(await requirePrincipal(requestHeaders(), ["owner", "admin", "member"]), data.requestId, data.memberId ? { memberId: data.memberId } : {})));
export const denyPairingFn = createServerFn({ method: "POST" }).inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(({ data }) => attempt(async () => { await denyPairing(await requirePrincipal(requestHeaders(), ["owner", "admin", "member"]), data.requestId); return {}; }));

export const refreshRunnerFn = createServerFn({ method: "POST" }).inputValidator(z.object({ runnerRowId: z.string().min(1) }))
  .handler(({ data }) => attempt(async () => refreshRunner(await requirePrincipal(requestHeaders()), data.runnerRowId)));
export const revokeRunnerFn = createServerFn({ method: "POST" }).inputValidator(revokeInputSchema)
  .handler(({ data }) => attempt(async () => { await revokeRunner(await requirePrincipal(requestHeaders()), data); return {}; }));
export const assignAccountFn = createServerFn({ method: "POST" }).inputValidator(assignInputSchema)
  .handler(({ data }) => attempt(async () => assignAccount(await requirePrincipal(requestHeaders()), data)));

export const getPolicy = createServerFn({ method: "GET" }).handler(() => attempt(async () => {
  const principal = await requirePrincipal(requestHeaders());
  return { active: await activePolicy(principal.organizationId), history: await policyHistory(principal.organizationId) };
}));
export const updatePolicyFn = createServerFn({ method: "POST" }).inputValidator(updatePolicyInputSchema)
  .handler(({ data }) => attempt(async () => ({ revision: await updatePolicy(await requirePrincipal(requestHeaders()), data) })));
