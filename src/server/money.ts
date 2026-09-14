import { z } from "zod";

/** App-wide money contract: exact non-negative integer minor units as a decimal string. Currency travels alongside. */
export const minorUnits = z.string().regex(/^(0|[1-9][0-9]*)$/, "Expected integer minor units as a string").max(30);
export type MinorUnits = z.infer<typeof minorUnits>;

export function compareMinor(a: MinorUnits, b: MinorUnits): -1 | 0 | 1 {
  const x = BigInt(a); const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function addMinor(a: MinorUnits, b: MinorUnits): MinorUnits { return (BigInt(a) + BigInt(b)).toString(); }
/** Legacy JS-number money is accepted only when it is a safe non-negative integer. */
export function fromLegacyNumber(value: number): MinorUnits {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Money must be a safe non-negative integer.");
  return String(value);
}
