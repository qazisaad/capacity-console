import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** SHA-256 of the installed protocol JSON schema; runners must present the same one before connecting. */
export const INSTALLED_PROTOCOL_SCHEMA_SHA256: string = createHash("sha256")
  .update(readFileSync(createRequire(import.meta.url).resolve("@harness-control/protocol/schema.json")))
  .digest("hex");
