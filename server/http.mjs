// Node http <-> Fetch conversion for the TanStack Start server entry. No framework adapter dependency.
import { Readable } from "node:stream";

/** Build a Fetch Request from a Node request. The origin comes from configuration, never from the Host header alone. */
export function toRequest(request, origin) {
  const url = new URL(request.url ?? "/", origin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  const method = request.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const controller = new AbortController();
  request.once("close", () => { if (!request.complete) controller.abort(); });
  return new Request(url, {
    method, headers, signal: controller.signal,
    ...(hasBody ? { body: Readable.toWeb(request), duplex: "half" } : {}),
  });
}

/** Write a Fetch Response to a Node response, streaming the body. */
export async function writeResponse(response, target) {
  const headers = {};
  for (const [name, value] of response.headers) {
    if (name === "set-cookie") continue;
    headers[name] = value;
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  target.writeHead(response.status, response.statusText, headers);
  if (!response.body) { target.end(); return; }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!target.write(value)) await new Promise(resolve => target.once("drain", resolve));
    }
  } finally { target.end(); }
}
