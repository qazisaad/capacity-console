import { getRequestHeaders, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";
import { z } from "zod";
import { AuthorizationError } from "../auth/session";

/** Request headers as a standard Headers object for the auth library. */
export function requestHeaders(): Headers {
  const headers = new Headers();
  for (const [name, value] of getRequestHeaders()) headers.set(name, value);
  return headers;
}

export type Failure = { ok: false; status: number; error: string };
export type Result<T> = ({ ok: true } & T) | Failure;

/** Map service errors to explicit results and statuses; never leak stack traces or raw provider errors. */
export async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    const value = await work();
    return { ok: true, ...value };
  } catch (error) {
    if (error instanceof AuthorizationError) { setResponseStatus(error.status); return { ok: false, status: error.status, error: error.message }; }
    if (error instanceof z.ZodError) { setResponseStatus(400); return { ok: false, status: 400, error: error.issues.map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") }; }
    if (isApiError(error)) { const status = error.statusCode ?? 400; setResponseStatus(status); return { ok: false, status, error: error.message }; }
    console.error("server function failed", error instanceof Error ? error.message : error);
    setResponseStatus(500);
    return { ok: false, status: 500, error: "The request failed. Check the server log." };
  }
}

export function applyCookies(cookies: string[]): void { if (cookies.length) setResponseHeader("set-cookie", cookies); }

function isApiError(error: unknown): error is { statusCode?: number; message: string } {
  return typeof error === "object" && error !== null && "statusCode" in error && "message" in error && typeof (error as { message: unknown }).message === "string";
}
