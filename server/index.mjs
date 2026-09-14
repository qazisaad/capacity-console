// Production process: one Node server hosting the TanStack Start handler, the HCP WebSocket
// upgrade path, and the background runtime. Run `npm run build` first.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { toRequest, writeResponse } from "./http.mjs";
import { serveStatic } from "./static.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const clientRoot = resolve(here, "../dist/client");
const entry = await import(resolve(here, "../dist/server/server.js"));

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const port = Number(process.env.PORT ?? new URL(origin).port ?? 3000);
const host = process.env.HOST ?? (new URL(origin).hostname === "localhost" ? "127.0.0.1" : "0.0.0.0");
const runtime = await entry.createRuntime();

const server = createServer((request, response) => {
  serveStatic(clientRoot, request, response).then(async served => {
    if (served) return;
    const result = await entry.default.fetch(toRequest(request, origin));
    await writeResponse(result, response);
  }).catch(error => {
    console.error("request failed", error instanceof Error ? error.message : error);
    if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
    response.end("Internal error");
  });
});
server.on("upgrade", (request, socket, head) => runtime.handleUpgrade(request, socket, head));

await new Promise((ok, fail) => { server.once("error", fail); server.listen(port, host, ok); });
console.log(`capacity-console listening on http://${host}:${port} (origin ${origin})`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return; shuttingDown = true;
  console.log(`${signal}: shutting down`);
  server.close();
  await runtime.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
