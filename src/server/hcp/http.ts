import { z } from "zod";
import { PairingError } from "./errors";

const MAX_BODY_BYTES = 64 * 1024;

/** JSON endpoint wrapper for the runner-facing pairing routes. Failures return `{error}` with a status and no internals. */
export async function pairingJson(request: Request, work: (body: unknown) => Promise<unknown>): Promise<Response> {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return Response.json({ error: "Request body too large." }, { status: 413 });
    const body: unknown = raw ? JSON.parse(raw) : {};
    return Response.json(await work(body), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PairingError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Invalid request." }, { status: 400 });
    console.error("pairing route failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Request failed." }, { status: 500 });
  }
}
