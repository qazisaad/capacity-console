export function cookieHeaders(cookies: string[]): Headers {
  return new Headers({ cookie: cookies.map(cookie => cookie.split(";")[0]!).join("; "), origin: process.env.APP_ORIGIN! });
}
