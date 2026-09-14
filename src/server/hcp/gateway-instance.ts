import type { RunnerGateway } from "./gateway";

let current: RunnerGateway | undefined;
export function setGateway(gateway: RunnerGateway | undefined): void { current = gateway; }
/** The process gateway, if the runtime started one. Request handlers use it for refresh/revoke; absent in tests without a runtime. */
export function gateway(): RunnerGateway | undefined { return current; }
