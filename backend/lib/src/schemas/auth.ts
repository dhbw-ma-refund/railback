// Auth endpoints — register / login / refresh.
// IBAN and BIC are required at registration (locked 2026-06-21 — see
// DECISIONS.md). Without bank data the refund flow has no graceful path,
// so the wizard's "Bankdaten" step is mandatory before submit.
// datenschutz_einwilligung and agb_akzeptiert must be literal true on
// register.

import { z } from "zod";
import { ROLES } from "../types/enums.js";
import { addressSchema, bicSchema, emailSchema, ibanSchema } from "./common.js";

// Strings are bounded — DDB has a 400 KB item cap and unbounded
// user-input fields can be abused to bloat rows. Password caps at 256
// (scrypt is happy with any reasonable length; the bound just blocks
// gigabyte-passwords-as-DoS).
export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(256),
    vorname: z.string().min(1).max(100),
    nachname: z.string().min(1).max(100),
    telefon: z.string().min(1).max(40),
    adresse: addressSchema,
    iban: ibanSchema,
    bic: bicSchema,
    datenschutz_einwilligung: z.literal(true),
    agb_akzeptiert: z.literal(true),
  })
  .openapi("RegisterRequest", {
    description: "POST /auth/register body. IBAN/BIC required at registration.",
  });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(256),
  })
  .openapi("LoginRequest", { description: "POST /auth/login body." });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z
  .object({
    refreshToken: z.string().min(1),
  })
  .openapi("RefreshRequest", { description: "POST /auth/refresh body." });
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const authResponseSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number().int().positive(),
    user: z.object({
      email: z.string(),
      vorname: z.string(),
      nachname: z.string(),
      role: z.enum(ROLES),
    }),
  })
  .openapi("AuthResponse", {
    description:
      "Shared response for /auth/register, /auth/login, /auth/refresh.",
  });
export type AuthResponse = z.infer<typeof authResponseSchema>;
