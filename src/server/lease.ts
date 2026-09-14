import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { runtimeLease } from "./db/schema";
import { randomId } from "./secrets";
import { runtimeState } from "./runtime-state";

/** One active app process per database. Losing the lease stops dispatch; readiness reports it. */
export class RuntimeLease {
  readonly owner: string = randomId();
  #timer: NodeJS.Timeout | undefined;
  #held = false;
  constructor(private readonly db: Db, private readonly options: { ttlMs?: number; intervalMs?: number; onLost?: () => void } = {}) {}

  get held(): boolean { return this.#held; }

  async acquire(): Promise<boolean> {
    const ttl = this.options.ttlMs ?? 30_000;
    const rows = await this.db.insert(runtimeLease)
      .values({ id: 1, owner: this.owner, acquiredAt: sql`now()`, expiresAt: sql`now() + make_interval(secs => ${ttl / 1000})` })
      .onConflictDoUpdate({ target: runtimeLease.id,
        set: { owner: this.owner, acquiredAt: sql`now()`, expiresAt: sql`now() + make_interval(secs => ${ttl / 1000})` },
        setWhere: sql`${runtimeLease.expiresAt} < now() or ${runtimeLease.owner} = ${this.owner}` })
      .returning({ owner: runtimeLease.owner });
    this.#set(rows[0]?.owner === this.owner);
    return this.#held;
  }

  start(): void {
    this.#timer = setInterval(() => { void this.acquire().catch(() => this.#set(false)); }, this.options.intervalMs ?? 10_000);
    this.#timer.unref();
  }

  async release(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#held) await this.db.delete(runtimeLease).where(eq(runtimeLease.owner, this.owner)).catch(() => undefined);
    this.#set(false, true);
  }

  #set(held: boolean, releasing = false): void {
    const lost = this.#held && !held && !releasing;
    this.#held = held;
    runtimeState.leaseHeld = held;
    runtimeState.leaseOwner = held ? this.owner : null;
    if (lost) this.options.onLost?.();
  }
}
