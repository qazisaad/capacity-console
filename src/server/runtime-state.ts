/** Process-local runtime flags surfaced by readiness. Owned by the runtime; read-only elsewhere. */
export const runtimeState: { leaseHeld: boolean; leaseOwner: string | null; shuttingDown: boolean } = { leaseHeld: false, leaseOwner: null, shuttingDown: false };
