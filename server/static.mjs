import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".map": "application/json" };

/** Serve a built client asset if it exists under `root`; returns false when the request is not a static file. */
export async function serveStatic(root, request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  if (pathname === "/" || pathname.includes("\0")) return false;
  const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = join(root, relative);
  if (!file.startsWith(root + sep)) return false;
  let info;
  try { info = await stat(file); } catch { return false; }
  if (!info.isFile()) return false;
  const immutable = relative.startsWith(`${sep}assets${sep}`) || relative.startsWith(`assets${sep}`);
  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") { response.end(); return true; }
  await new Promise((resolve, reject) => createReadStream(file).on("error", reject).on("end", resolve).pipe(response));
  return true;
}
