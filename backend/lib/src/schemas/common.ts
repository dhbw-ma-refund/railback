// Shared zod primitives. Transforms normalise inputs (email lowercase, IBAN/BIC
// uppercase + whitespace strip) so downstream code never sees raw forms.

import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { ERROR_CODES } from "../types/enums.js";
import { validateBic, validateIban } from "../sepa/validators.js";

// Wire the .openapi() extension onto z.ZodType.prototype once, before any
// schema in this package tries to call .openapi(). common.ts is the shared
// import root for every other schema module, so this runs first.
extendZodWithOpenApi(z);

// Trim + lowercase BEFORE the format check so "  Foo@Bar.COM " round-trips
// to "foo@bar.com" without tripping z.email() on the surrounding whitespace.
export const emailSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().email());
export type Email = z.infer<typeof emailSchema>;

// IBAN: normalise (strip whitespace, uppercase) → regex shape → mod-97
// checksum via validateIban. Pre-encrypt validation catches typos at the
// boundary rather than letting bad bytes land in the user row.
export const ibanSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/))
  .refine((s) => validateIban(s).valid, {
    message: "IBAN checksum (mod-97) failed",
  });
export type Iban = z.infer<typeof ibanSchema>;

// BIC: normalise → regex (covered by validateBic, kept here for the
// pipe-stage error). The validateBic call adds nothing on top of the
// regex for BIC, but we route through it so a future stricter check
// (e.g. country-code allowlist) lands centrally.
export const bicSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/))
  .refine((s) => validateBic(s).valid, {
    message: "BIC format check failed",
  });
export type Bic = z.infer<typeof bicSchema>;

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export type Ulid = z.infer<typeof ulidSchema>;

export const iso8601DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type Iso8601Date = z.infer<typeof iso8601DateSchema>;

export const iso8601DateTimeSchema = z.string().datetime({ offset: true });
export type Iso8601DateTime = z.infer<typeof iso8601DateTimeSchema>;

export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type Hhmm = z.infer<typeof hhmmSchema>;

export const decimalEurSchema = z.string().regex(/^-?[0-9]+\.[0-9]{2}$/);
export type DecimalEur = z.infer<typeof decimalEurSchema>;

// Address subfields are bounded — DDB has a 400 KB item cap and unbounded
// user-input strings can be weaponised to bloat rows. Bounds are
// generously over typical real-world values (longest German street name
// is ~50 chars; PLZ is 5 digits; ISO country code is 2 chars) but stay
// well clear of the DDB ceiling.
export const addressSchema = z.object({
  strasse: z.string().min(1).max(200),
  hausnr: z.string().min(1).max(20),
  plz: z.string().min(1).max(20),
  ort: z.string().min(1).max(200),
  land: z.string().min(1).max(80),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorBodySchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    }),
  })
  .openapi("ErrorBody", {
    description:
      "Uniform error envelope. `error.code` is one of ERROR_CODES; `error.details` is an opaque bag.",
  });
export type ErrorBody = z.infer<typeof errorBodySchema>;
