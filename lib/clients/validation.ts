import { z } from "zod";

// ============================================================================
// Clients validation — Zod schemas for the consulting CRM write paths.
// Bounds mirror the varchar limits in lib/db/schema.ts so a value that passes
// validation always fits the column. All free-text is trimmed; empty strings
// on optional fields normalise to undefined so they never overwrite a column
// with "" — the service maps undefined → null where appropriate.
// ============================================================================

/** Trimmed string, bounded to `max`, optional. "" → undefined (not stored). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/** Trimmed, non-empty, bounded required string. */
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** ISO calendar date (YYYY-MM-DD), optional. Matches Drizzle date mode:string. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/** Money as a numeric string, e.g. "1100.00". Drizzle numeric is string-typed. */
const billingRate = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Billing rate must be a number like 1100.00")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

// ---- client ----------------------------------------------------------------

export const createClientSchema = z.object({
  name: requiredText(255),
  industry: optionalText(100),
  website: optionalText(500),
  companySize: optionalText(50),
  abnTaxId: optionalText(50),
  addressLine1: optionalText(255),
  addressLine2: optionalText(255),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
  notes: optionalText(20000),
});

// Update: every field optional, but reject an empty object so a no-op PATCH is
// a 400 rather than a silent success. name stays non-empty when present.
export const updateClientSchema = createClientSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field is required" },
);

// ---- contact ---------------------------------------------------------------

export const contactSchema = z.object({
  name: requiredText(255),
  email: z
    .string()
    .trim()
    .max(255)
    .email("Invalid email address")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  phone: optionalText(50),
  role: optionalText(100),
  isPrimary: z.boolean().optional(),
});

export const updateContactSchema = contactSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field is required" },
);

// ---- contract --------------------------------------------------------------

export const contractSchema = z.object({
  name: requiredText(255),
  contractType: optionalText(50),
  status: optionalText(30),
  startDate: isoDate,
  endDate: isoDate,
  billingRate,
  notes: optionalText(20000),
});

export const updateContractSchema = contractSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field is required" },
);

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ContractInput = z.infer<typeof contractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
