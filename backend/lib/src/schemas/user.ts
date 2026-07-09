// /users/me endpoints — profile, refund-data (incl. iban/bic), bank update,
// self-delete.

import { z } from "zod";
import { USER_STATES } from "../types/enums.js";
import {
  addressSchema,
  bicSchema,
  emailSchema,
  ibanSchema,
  iso8601DateTimeSchema,
} from "./common.js";

export const getUserResponseSchema = z
  .object({
    email: z.string(),
    vorname: z.string(),
    nachname: z.string(),
    telefon: z.string(),
    adresse: addressSchema,
    user_state: z.enum(USER_STATES),
    created_at: iso8601DateTimeSchema,
  })
  .openapi("GetUserResponse", {
    description:
      "GET /users/me — general profile view. Never carries IBAN/BIC.",
  });
export type GetUserResponse = z.infer<typeof getUserResponseSchema>;

export const patchUserRequestSchema = z
  .object({
    vorname: z.string().min(1).max(100).optional(),
    nachname: z.string().min(1).max(100).optional(),
    telefon: z.string().min(1).max(40).optional(),
    adresse: addressSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "at least one field must be provided",
  });
export type PatchUserRequest = z.infer<typeof patchUserRequestSchema>;

export const refundDataResponseSchema = z
  .object({
    vorname: z.string(),
    nachname: z.string(),
    email: z.string(),
    telefon: z.string(),
    adresse: addressSchema,
    iban: z.string().nullable(),
    bic: z.string().nullable(),
  })
  .openapi("RefundDataResponse", {
    description:
      "GET /users/me/refund-data — field-set the EU-form needs; includes IBAN/BIC.",
  });
export type RefundDataResponse = z.infer<typeof refundDataResponseSchema>;

export const patchBankRequestSchema = z.object({
  iban: ibanSchema,
  bic: bicSchema,
});
export type PatchBankRequest = z.infer<typeof patchBankRequestSchema>;

export const deleteUserRequestSchema = z.object({
  confirmPassword: z.string().min(1).max(256),
});
export type DeleteUserRequest = z.infer<typeof deleteUserRequestSchema>;

// Re-exported here so user-handler can validate query/body of /users/me/* by
// the request shape it actually receives — kept thin (no body) for parity.
export const meEmailQuerySchema = z.object({ email: emailSchema });
export type MeEmailQuery = z.infer<typeof meEmailQuerySchema>;
