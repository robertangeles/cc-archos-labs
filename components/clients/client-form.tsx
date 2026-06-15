"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

// ============================================================================
// ClientForm — reusable create/edit form for a consulting client.
//
// One component serves both the "Add client" (create) and "Edit client" flows.
// Field bounds mirror lib/clients/validation.ts so the form rejects bad input
// before the request ever leaves the browser; the server still re-validates.
// All errors shown to the user are plain language — never a raw exception.
// ============================================================================

/** The editable shape of a client. Mirrors createClientSchema's fields. */
export interface ClientFormValues {
  name: string;
  industry: string;
  website: string;
  companySize: string;
  abnTaxId: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  notes: string;
}

/** Field bounds copied from lib/clients/validation.ts (the server source). */
const MAX = {
  name: 255,
  industry: 100,
  website: 500,
  companySize: 50,
  abnTaxId: 50,
  addressLine1: 255,
  addressLine2: 255,
  city: 100,
  state: 100,
  postalCode: 20,
  country: 100,
  notes: 20000,
} as const;

export const EMPTY_CLIENT: ClientFormValues = {
  name: "",
  industry: "",
  website: "",
  companySize: "",
  abnTaxId: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  notes: "",
};

/** Client-side validation mirroring the server bounds. Returns a field→message map. */
function validate(values: ClientFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (name.length === 0) {
    errors.name = "Client name is required.";
  } else if (name.length > MAX.name) {
    errors.name = `Keep the name under ${MAX.name} characters.`;
  }

  (Object.keys(MAX) as Array<keyof typeof MAX>).forEach((field) => {
    if (field === "name") return;
    if (values[field].trim().length > MAX[field]) {
      errors[field] = `Keep this under ${MAX[field]} characters.`;
    }
  });

  return errors;
}

const FIELD_STYLES =
  "mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const LABEL_STYLES =
  "block text-xs font-medium uppercase tracking-wider text-ink-subtle";

interface FieldProps {
  id: keyof ClientFormValues;
  label: string;
  values: ClientFormValues;
  errors: Record<string, string>;
  onChange: (id: keyof ClientFormValues, value: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  required?: boolean;
}

function Field({
  id,
  label,
  values,
  errors,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  required,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={`client-${id}`} className={LABEL_STYLES}>
        {label}
        {required && <span className="text-semantic-error"> *</span>}
      </label>
      <input
        id={`client-${id}`}
        type={type}
        value={values[id]}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(id, e.target.value)}
        className={FIELD_STYLES}
        aria-invalid={errors[id] ? true : undefined}
      />
      {errors[id] && (
        <p className="mt-1 text-xs text-semantic-error">{errors[id]}</p>
      )}
    </div>
  );
}

interface ClientFormProps {
  initialValues?: ClientFormValues;
  /** Called with trimmed-but-raw values; the parent owns the fetch. Throw or
   *  return a string to surface a form-level error message. */
  onSubmit: (values: ClientFormValues) => Promise<string | void>;
  onCancel: () => void;
  submitLabel: string;
}

export function ClientForm({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
}: ClientFormProps) {
  const [values, setValues] = useState<ClientFormValues>(
    initialValues ?? EMPTY_CLIENT,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(id: keyof ClientFormValues, value: string) {
    setValues((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validate(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      const message = await onSubmit(values);
      if (typeof message === "string") {
        setFormError(message);
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field
        id="name"
        label="Client name"
        values={values}
        errors={errors}
        onChange={update}
        placeholder="Acme Financial"
        maxLength={MAX.name}
        required
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="industry"
          label="Industry"
          values={values}
          errors={errors}
          onChange={update}
          placeholder="Financial services"
          maxLength={MAX.industry}
        />
        <Field
          id="companySize"
          label="Company size"
          values={values}
          errors={errors}
          onChange={update}
          placeholder="500–1000"
          maxLength={MAX.companySize}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="website"
          label="Website"
          values={values}
          errors={errors}
          onChange={update}
          placeholder="https://acme.com"
          maxLength={MAX.website}
        />
        <Field
          id="abnTaxId"
          label="ABN / Tax ID"
          values={values}
          errors={errors}
          onChange={update}
          placeholder="12 345 678 901"
          maxLength={MAX.abnTaxId}
        />
      </div>

      <div className="space-y-5 rounded-lg border border-hairline bg-surface-1 p-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
          Address
        </p>
        <Field
          id="addressLine1"
          label="Address line 1"
          values={values}
          errors={errors}
          onChange={update}
          placeholder="Level 10, 123 Collins Street"
          maxLength={MAX.addressLine1}
        />
        <Field
          id="addressLine2"
          label="Address line 2"
          values={values}
          errors={errors}
          onChange={update}
          maxLength={MAX.addressLine2}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="city"
            label="City"
            values={values}
            errors={errors}
            onChange={update}
            placeholder="Melbourne"
            maxLength={MAX.city}
          />
          <Field
            id="state"
            label="State"
            values={values}
            errors={errors}
            onChange={update}
            placeholder="VIC"
            maxLength={MAX.state}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="postalCode"
            label="Postal code"
            values={values}
            errors={errors}
            onChange={update}
            placeholder="3000"
            maxLength={MAX.postalCode}
          />
          <Field
            id="country"
            label="Country"
            values={values}
            errors={errors}
            onChange={update}
            placeholder="Australia"
            maxLength={MAX.country}
          />
        </div>
      </div>

      <div>
        <label htmlFor="client-notes" className={LABEL_STYLES}>
          Notes
        </label>
        <textarea
          id="client-notes"
          rows={4}
          value={values.notes}
          maxLength={MAX.notes}
          placeholder="Context, engagement history, anything worth remembering."
          onChange={(e) => update("notes", e.target.value)}
          className={FIELD_STYLES}
          aria-invalid={errors.notes ? true : undefined}
        />
        {errors.notes && (
          <p className="mt-1 text-xs text-semantic-error">{errors.notes}</p>
        )}
      </div>

      {formError && (
        <div className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3">
          <p className="text-sm text-semantic-error">{formError}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex min-h-11 items-center rounded-md border border-hairline bg-surface-1 px-4 py-2 text-sm font-medium text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
