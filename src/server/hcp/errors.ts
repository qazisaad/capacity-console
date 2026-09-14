export class PairingError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 410 | 503, message: string) { super(message); }
}
