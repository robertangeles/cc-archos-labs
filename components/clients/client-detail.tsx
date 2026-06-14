"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Pencil,
  Trash2,
  Plus,
  Loader2,
  Mail,
  Phone,
  Globe,
  MapPin,
  Star,
  X,
  FileText,
} from "lucide-react";
import { ClientForm, type ClientFormValues } from "./client-form";

// ============================================================================
// ClientDetail — the right pane: one client's full record.
//
// Three stacked sections, each mirroring the skills-list card language
// (surface-1 card, hairline border, accent-tinted icon square):
//   1. Client fields + an inline edit form (PATCH) + delete (owner/admin).
//   2. Contacts — list with add / edit / delete.
//   3. Contracts — list with add / edit / delete.
//
// Writes are optimistic about permission. A 403 from any mutation calls
// onPermissionDenied() so the parent hides every write affordance, and the
// local handler surfaces a plain "no permission" message.
// ============================================================================

export interface Client {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  companySize: string | null;
  abnTaxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Contact {
  id: string;
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Contract {
  id: string;
  clientId: string;
  name: string;
  contractType: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  billingRate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientDetailProps {
  client: Client;
  canWrite: boolean;
  onPermissionDenied: () => void;
  onUpdated: (client: Client) => void;
  onDeleted: (id: string) => void;
}

/** Turn nullable client columns into the all-string shape the form expects. */
function toFormValues(c: Client): ClientFormValues {
  return {
    name: c.name,
    industry: c.industry ?? "",
    website: c.website ?? "",
    companySize: c.companySize ?? "",
    abnTaxId: c.abnTaxId ?? "",
    addressLine1: c.addressLine1 ?? "",
    addressLine2: c.addressLine2 ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    postalCode: c.postalCode ?? "",
    country: c.country ?? "",
    notes: c.notes ?? "",
  };
}

/** Trim every field so the PATCH body matches what server validation expects. */
function trimValues(values: ClientFormValues): ClientFormValues {
  const out = { ...values };
  (Object.keys(out) as Array<keyof ClientFormValues>).forEach((k) => {
    out[k] = out[k].trim();
  });
  return out;
}

function formatAddress(c: Client): string | null {
  const parts = [
    c.addressLine1,
    c.addressLine2,
    c.city,
    c.state,
    c.postalCode,
    c.country,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      type: "spring" as const,
      stiffness: 100,
      damping: 10,
    },
  }),
};

export function ClientDetail({
  client,
  canWrite,
  onPermissionDenied,
  onUpdated,
  onDeleted,
}: ClientDetailProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Save edits to the client. Returns a plain message to the form on failure. */
  async function handleEditSubmit(
    values: ClientFormValues,
  ): Promise<string | void> {
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trimValues(values)),
    });
    if (res.status === 403) {
      onPermissionDenied();
      return "You don't have permission to edit this client.";
    }
    if (!res.ok) {
      return "We couldn't save your changes. Please try again.";
    }
    const data = await res.json();
    if (data.client) {
      onUpdated(data.client);
    }
    setEditing(false);
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete ${client.name}? This removes the client and all its contacts and contracts. This cannot be undone.`,
      )
    ) {
      return;
    }
    setActionError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "DELETE",
      });
      if (res.status === 403) {
        onPermissionDenied();
        setActionError("You don't have permission to delete this client.");
        return;
      }
      if (!res.ok) {
        setActionError("We couldn't delete this client. Please try again.");
        return;
      }
      onDeleted(client.id);
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  const address = formatAddress(client);

  return (
    <div className="space-y-6">
      {/* ── Client card ── */}
      <section className="rounded-lg border border-hairline bg-surface-1 p-6">
        {editing ? (
          <div>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Edit client</h2>
              <button
                onClick={() => setEditing(false)}
                aria-label="Cancel edit"
                className="flex h-9 w-9 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ClientForm
              initialValues={toFormValues(client)}
              onSubmit={handleEditSubmit}
              onCancel={() => setEditing(false)}
              submitLabel="Save changes"
            />
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-primary) 10%, transparent)",
                    color: "var(--color-primary)",
                  }}
                >
                  <span className="text-base font-semibold">
                    {client.name.charAt(0).toUpperCase()}
                  </span>
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                    {client.name}
                  </h2>
                  {client.industry && (
                    <p className="truncate text-sm text-ink-subtle">
                      {client.industry}
                    </p>
                  )}
                </div>
              </div>
              {canWrite && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm font-medium text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    aria-label="Delete client"
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm font-medium text-semantic-error/80 transition-colors hover:border-semantic-error/40 hover:text-semantic-error disabled:opacity-60"
                  >
                    {deleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Field grid */}
            <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <DetailRow label="Company size" value={client.companySize} />
              <DetailRow label="ABN / Tax ID" value={client.abnTaxId} />
              {client.website && (
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
                    Website
                  </dt>
                  <dd className="mt-1">
                    <a
                      href={client.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary-hover"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span className="truncate">{client.website}</span>
                    </a>
                  </dd>
                </div>
              )}
              {address && (
                <div className="sm:col-span-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
                    Address
                  </dt>
                  <dd className="mt-1 flex items-start gap-1.5 text-sm text-ink-muted">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
                    <span>{address}</span>
                  </dd>
                </div>
              )}
            </dl>

            {client.notes && (
              <div className="mt-6 border-t border-hairline pt-4">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
                  Notes
                </dt>
                <dd className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                  {client.notes}
                </dd>
              </div>
            )}

            {actionError && (
              <p className="mt-4 text-sm text-semantic-error">{actionError}</p>
            )}
          </div>
        )}
      </section>

      {/* ── Contacts ── */}
      <ContactsSection
        clientId={client.id}
        canWrite={canWrite}
        onPermissionDenied={onPermissionDenied}
      />

      {/* ── Contracts ── */}
      <ContractsSection
        clientId={client.id}
        canWrite={canWrite}
        onPermissionDenied={onPermissionDenied}
      />
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink-muted">{value}</dd>
    </div>
  );
}

// ============================================================================
// Contacts
// ============================================================================

const CONTACT_MAX = {
  name: 255,
  email: 255,
  phone: 50,
  role: 100,
} as const;

interface ContactFormValues {
  name: string;
  email: string;
  phone: string;
  role: string;
  isPrimary: boolean;
}

const EMPTY_CONTACT: ContactFormValues = {
  name: "",
  email: "",
  phone: "",
  role: "",
  isPrimary: false,
};

function validateContact(v: ContactFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (v.name.trim().length === 0) {
    errors.name = "Contact name is required.";
  } else if (v.name.trim().length > CONTACT_MAX.name) {
    errors.name = `Keep the name under ${CONTACT_MAX.name} characters.`;
  }
  const email = v.email.trim();
  if (email.length > 0) {
    if (email.length > CONTACT_MAX.email) {
      errors.email = `Keep the email under ${CONTACT_MAX.email} characters.`;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Enter a valid email address.";
    }
  }
  if (v.phone.trim().length > CONTACT_MAX.phone) {
    errors.phone = `Keep the phone under ${CONTACT_MAX.phone} characters.`;
  }
  if (v.role.trim().length > CONTACT_MAX.role) {
    errors.role = `Keep the role under ${CONTACT_MAX.role} characters.`;
  }
  return errors;
}

function ContactsSection({
  clientId,
  canWrite,
  onPermissionDenied,
}: {
  clientId: string;
  canWrite: boolean;
  onPermissionDenied: () => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);

  // Load this client's contacts. setState lives in promise callbacks so it
  // doesn't trip the cascading-render lint rule.
  useEffect(() => {
    fetch(`/api/clients/${clientId}/contacts`)
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((data) => setContacts(data.contacts ?? []))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  async function handleCreate(
    values: ContactFormValues,
  ): Promise<string | void> {
    const res = await fetch(`/api/clients/${clientId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeContact(values)),
    });
    if (res.status === 403) {
      onPermissionDenied();
      return "You don't have permission to add contacts.";
    }
    if (!res.ok) {
      return "We couldn't save this contact. Please try again.";
    }
    const data = await res.json();
    if (data.contact) setContacts((prev) => [data.contact, ...prev]);
    setAdding(false);
  }

  async function handleUpdate(
    id: string,
    values: ContactFormValues,
  ): Promise<string | void> {
    const res = await fetch(`/api/clients/${clientId}/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeContact(values)),
    });
    if (res.status === 403) {
      onPermissionDenied();
      return "You don't have permission to edit contacts.";
    }
    if (!res.ok) {
      return "We couldn't save your changes. Please try again.";
    }
    const data = await res.json();
    if (data.contact) {
      setContacts((prev) =>
        prev.map((c) => (c.id === id ? data.contact : c)),
      );
    }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this contact? This cannot be undone.")) return;
    setSectionError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts/${id}`, {
        method: "DELETE",
      });
      if (res.status === 403) {
        onPermissionDenied();
        setSectionError("You don't have permission to remove contacts.");
        return;
      }
      if (!res.ok) {
        setSectionError("We couldn't remove this contact. Please try again.");
        return;
      }
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setSectionError("Network error. Please try again.");
    }
  }

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-6">
      <SectionHeader
        title="Contacts"
        count={contacts.length}
        canWrite={canWrite}
        addLabel="Add contact"
        onAdd={() => {
          setAdding(true);
          setEditingId(null);
        }}
      />

      {sectionError && (
        <p className="mt-3 text-sm text-semantic-error">{sectionError}</p>
      )}

      {adding && (
        <div className="mt-4">
          <ContactEditor
            initialValues={EMPTY_CONTACT}
            onSubmit={handleCreate}
            onCancel={() => setAdding(false)}
            submitLabel="Add contact"
          />
        </div>
      )}

      {loading ? (
        <div className="mt-4 space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-hairline bg-surface-2"
            />
          ))}
        </div>
      ) : contacts.length === 0 && !adding ? (
        <p className="mt-4 text-sm text-ink-subtle">
          No contacts yet.
          {canWrite && " Add the first point of contact for this client."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {contacts.map((c, i) => (
            <motion.li
              key={c.id}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
            >
              {editingId === c.id ? (
                <ContactEditor
                  initialValues={{
                    name: c.name,
                    email: c.email ?? "",
                    phone: c.phone ?? "",
                    role: c.role ?? "",
                    isPrimary: c.isPrimary,
                  }}
                  onSubmit={(v) => handleUpdate(c.id, v)}
                  onCancel={() => setEditingId(null)}
                  submitLabel="Save changes"
                />
              ) : (
                <div
                  className="rounded-lg border border-hairline bg-surface-2 px-4 py-3"
                  style={{
                    borderLeftWidth: "3px",
                    borderLeftColor: c.isPrimary
                      ? "var(--color-primary)"
                      : "var(--color-hairline)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">
                          {c.name}
                        </span>
                        {c.isPrimary && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor:
                                "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                              color: "var(--color-primary)",
                            }}
                          >
                            <Star className="h-2.5 w-2.5" />
                            Primary
                          </span>
                        )}
                      </div>
                      {c.role && (
                        <p className="mt-0.5 text-xs text-ink-subtle">
                          {c.role}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {c.email && (
                          <a
                            href={`mailto:${c.email}`}
                            className="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-primary"
                          >
                            <Mail className="h-3 w-3" />
                            {c.email}
                          </a>
                        )}
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-primary"
                          >
                            <Phone className="h-3 w-3" />
                            {c.phone}
                          </a>
                        )}
                      </div>
                    </div>
                    {canWrite && (
                      <RowActions
                        onEdit={() => {
                          setEditingId(c.id);
                          setAdding(false);
                        }}
                        onDelete={() => handleDelete(c.id)}
                        editLabel="Edit contact"
                        deleteLabel="Remove contact"
                      />
                    )}
                  </div>
                </div>
              )}
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Map the form's strings to the JSON the contact API expects. */
function serializeContact(v: ContactFormValues) {
  return {
    name: v.name.trim(),
    email: v.email.trim(),
    phone: v.phone.trim(),
    role: v.role.trim(),
    isPrimary: v.isPrimary,
  };
}

function ContactEditor({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initialValues: ContactFormValues;
  onSubmit: (values: ContactFormValues) => Promise<string | void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [values, setValues] = useState<ContactFormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ContactFormValues>(
    key: K,
    value: ContactFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validateContact(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      const message = await onSubmit(values);
      if (typeof message === "string") setFormError(message);
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-hairline bg-surface-2 p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SmallField
          label="Name"
          value={values.name}
          onChange={(v) => set("name", v)}
          error={errors.name}
          maxLength={CONTACT_MAX.name}
          placeholder="Jane Smith"
        />
        <SmallField
          label="Role"
          value={values.role}
          onChange={(v) => set("role", v)}
          error={errors.role}
          maxLength={CONTACT_MAX.role}
          placeholder="Head of Data"
        />
        <SmallField
          label="Email"
          type="email"
          value={values.email}
          onChange={(v) => set("email", v)}
          error={errors.email}
          maxLength={CONTACT_MAX.email}
          placeholder="jane@acme.com"
        />
        <SmallField
          label="Phone"
          value={values.phone}
          onChange={(v) => set("phone", v)}
          error={errors.phone}
          maxLength={CONTACT_MAX.phone}
          placeholder="+61 400 000 000"
        />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-subtle">
        <input
          type="checkbox"
          checked={values.isPrimary}
          onChange={(e) => set("isPrimary", e.target.checked)}
          className="h-4 w-4 rounded border-hairline bg-surface-1 text-primary focus:ring-1 focus:ring-primary"
        />
        Primary contact
      </label>

      {formError && <p className="text-sm text-semantic-error">{formError}</p>}

      <EditorButtons saving={saving} onCancel={onCancel} submitLabel={submitLabel} />
    </form>
  );
}

// ============================================================================
// Contracts
// ============================================================================

const CONTRACT_MAX = {
  name: 255,
  contractType: 50,
  status: 30,
  notes: 20000,
} as const;

interface ContractFormValues {
  name: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate: string;
  billingRate: string;
  notes: string;
}

const EMPTY_CONTRACT: ContractFormValues = {
  name: "",
  contractType: "",
  status: "",
  startDate: "",
  endDate: "",
  billingRate: "",
  notes: "",
};

function validateContract(v: ContractFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (v.name.trim().length === 0) {
    errors.name = "Contract name is required.";
  } else if (v.name.trim().length > CONTRACT_MAX.name) {
    errors.name = `Keep the name under ${CONTRACT_MAX.name} characters.`;
  }
  if (v.contractType.trim().length > CONTRACT_MAX.contractType) {
    errors.contractType = `Keep this under ${CONTRACT_MAX.contractType} characters.`;
  }
  if (v.status.trim().length > CONTRACT_MAX.status) {
    errors.status = `Keep this under ${CONTRACT_MAX.status} characters.`;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (v.startDate.trim() && !date.test(v.startDate.trim())) {
    errors.startDate = "Use the date picker (YYYY-MM-DD).";
  }
  if (v.endDate.trim() && !date.test(v.endDate.trim())) {
    errors.endDate = "Use the date picker (YYYY-MM-DD).";
  }
  if (
    v.billingRate.trim() &&
    !/^\d{1,10}(\.\d{1,2})?$/.test(v.billingRate.trim())
  ) {
    errors.billingRate = "Enter a number like 1100 or 1100.00.";
  }
  if (v.notes.trim().length > CONTRACT_MAX.notes) {
    errors.notes = `Keep notes under ${CONTRACT_MAX.notes} characters.`;
  }
  return errors;
}

function ContractsSection({
  clientId,
  canWrite,
  onPermissionDenied,
}: {
  clientId: string;
  canWrite: boolean;
  onPermissionDenied: () => void;
}) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);

  // Load this client's contracts. setState lives in promise callbacks so it
  // doesn't trip the cascading-render lint rule.
  useEffect(() => {
    fetch(`/api/clients/${clientId}/contracts`)
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((data) => setContracts(data.contracts ?? []))
      .catch(() => setContracts([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  async function handleCreate(
    values: ContractFormValues,
  ): Promise<string | void> {
    const res = await fetch(`/api/clients/${clientId}/contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeContract(values)),
    });
    if (res.status === 403) {
      onPermissionDenied();
      return "You don't have permission to add contracts.";
    }
    if (!res.ok) {
      return "We couldn't save this contract. Please try again.";
    }
    const data = await res.json();
    if (data.contract) setContracts((prev) => [data.contract, ...prev]);
    setAdding(false);
  }

  async function handleUpdate(
    id: string,
    values: ContractFormValues,
  ): Promise<string | void> {
    const res = await fetch(`/api/clients/${clientId}/contracts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serializeContract(values)),
    });
    if (res.status === 403) {
      onPermissionDenied();
      return "You don't have permission to edit contracts.";
    }
    if (!res.ok) {
      return "We couldn't save your changes. Please try again.";
    }
    const data = await res.json();
    if (data.contract) {
      setContracts((prev) =>
        prev.map((c) => (c.id === id ? data.contract : c)),
      );
    }
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contract? This cannot be undone.")) return;
    setSectionError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/contracts/${id}`, {
        method: "DELETE",
      });
      if (res.status === 403) {
        onPermissionDenied();
        setSectionError("You don't have permission to delete contracts.");
        return;
      }
      if (!res.ok) {
        setSectionError("We couldn't delete this contract. Please try again.");
        return;
      }
      setContracts((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setSectionError("Network error. Please try again.");
    }
  }

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-6">
      <SectionHeader
        title="Contracts"
        count={contracts.length}
        canWrite={canWrite}
        addLabel="Add contract"
        onAdd={() => {
          setAdding(true);
          setEditingId(null);
        }}
      />

      {sectionError && (
        <p className="mt-3 text-sm text-semantic-error">{sectionError}</p>
      )}

      {adding && (
        <div className="mt-4">
          <ContractEditor
            initialValues={EMPTY_CONTRACT}
            onSubmit={handleCreate}
            onCancel={() => setAdding(false)}
            submitLabel="Add contract"
          />
        </div>
      )}

      {loading ? (
        <div className="mt-4 space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-hairline bg-surface-2"
            />
          ))}
        </div>
      ) : contracts.length === 0 && !adding ? (
        <p className="mt-4 text-sm text-ink-subtle">
          No contracts yet.
          {canWrite && " Record the first engagement for this client."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {contracts.map((c, i) => (
            <motion.li
              key={c.id}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
            >
              {editingId === c.id ? (
                <ContractEditor
                  initialValues={{
                    name: c.name,
                    contractType: c.contractType ?? "",
                    status: c.status ?? "",
                    startDate: c.startDate ?? "",
                    endDate: c.endDate ?? "",
                    billingRate: c.billingRate ?? "",
                    notes: c.notes ?? "",
                  }}
                  onSubmit={(v) => handleUpdate(c.id, v)}
                  onCancel={() => setEditingId(null)}
                  submitLabel="Save changes"
                />
              ) : (
                <div className="rounded-lg border border-hairline bg-surface-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
                          <FileText className="h-3.5 w-3.5 text-ink-tertiary" />
                          {c.name}
                        </span>
                        {c.status && (
                          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-subtle">
                            {c.status}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
                        {c.contractType && <span>{c.contractType}</span>}
                        {(c.startDate || c.endDate) && (
                          <span>
                            {c.startDate ?? "—"} → {c.endDate ?? "ongoing"}
                          </span>
                        )}
                        {c.billingRate && <span>Rate: {c.billingRate}</span>}
                      </div>
                      {c.notes && (
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">
                          {c.notes}
                        </p>
                      )}
                    </div>
                    {canWrite && (
                      <RowActions
                        onEdit={() => {
                          setEditingId(c.id);
                          setAdding(false);
                        }}
                        onDelete={() => handleDelete(c.id)}
                        editLabel="Edit contract"
                        deleteLabel="Delete contract"
                      />
                    )}
                  </div>
                </div>
              )}
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Map the form's strings to the JSON the contract API expects. */
function serializeContract(v: ContractFormValues) {
  return {
    name: v.name.trim(),
    contractType: v.contractType.trim(),
    status: v.status.trim(),
    startDate: v.startDate.trim(),
    endDate: v.endDate.trim(),
    billingRate: v.billingRate.trim(),
    notes: v.notes.trim(),
  };
}

function ContractEditor({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initialValues: ContractFormValues;
  onSubmit: (values: ContractFormValues) => Promise<string | void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [values, setValues] = useState<ContractFormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ContractFormValues>(
    key: K,
    value: ContractFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found = validateContract(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      const message = await onSubmit(values);
      if (typeof message === "string") setFormError(message);
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-hairline bg-surface-2 p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SmallField
          label="Contract name"
          value={values.name}
          onChange={(v) => set("name", v)}
          error={errors.name}
          maxLength={CONTRACT_MAX.name}
          placeholder="AI Readiness Assessment"
        />
        <SmallField
          label="Type"
          value={values.contractType}
          onChange={(v) => set("contractType", v)}
          error={errors.contractType}
          maxLength={CONTRACT_MAX.contractType}
          placeholder="Fixed price"
        />
        <SmallField
          label="Status"
          value={values.status}
          onChange={(v) => set("status", v)}
          error={errors.status}
          maxLength={CONTRACT_MAX.status}
          placeholder="Active"
        />
        <SmallField
          label="Billing rate"
          value={values.billingRate}
          onChange={(v) => set("billingRate", v)}
          error={errors.billingRate}
          placeholder="1100.00"
        />
        <SmallField
          label="Start date"
          type="date"
          value={values.startDate}
          onChange={(v) => set("startDate", v)}
          error={errors.startDate}
        />
        <SmallField
          label="End date"
          type="date"
          value={values.endDate}
          onChange={(v) => set("endDate", v)}
          error={errors.endDate}
        />
      </div>

      <div>
        <label className="block text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
          Notes
        </label>
        <textarea
          rows={3}
          value={values.notes}
          maxLength={CONTRACT_MAX.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {errors.notes && (
          <p className="mt-1 text-xs text-semantic-error">{errors.notes}</p>
        )}
      </div>

      {formError && <p className="text-sm text-semantic-error">{formError}</p>}

      <EditorButtons saving={saving} onCancel={onCancel} submitLabel={submitLabel} />
    </form>
  );
}

// ============================================================================
// Shared small pieces
// ============================================================================

function SectionHeader({
  title,
  count,
  canWrite,
  addLabel,
  onAdd,
}: {
  title: string;
  count: number;
  canWrite: boolean;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="flex items-baseline gap-2 text-base font-semibold text-ink">
        {title}
        <span className="text-[11px] font-normal text-ink-tertiary">
          {count}
        </span>
      </h3>
      {canWrite && (
        <button
          onClick={onAdd}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm font-medium text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      )}
    </div>
  );
}

function RowActions({
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
}: {
  onEdit: () => void;
  onDelete: () => void;
  editLabel: string;
  deleteLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={onEdit}
        aria-label={editLabel}
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        aria-label={deleteLabel}
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-semantic-error/10 hover:text-semantic-error"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SmallField({
  label,
  value,
  onChange,
  error,
  type = "text",
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-ink-tertiary">
        {label}
      </label>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        aria-invalid={error ? true : undefined}
      />
      {error && <p className="mt-1 text-xs text-semantic-error">{error}</p>}
    </div>
  );
}

function EditorButtons({
  saving,
  onCancel,
  submitLabel,
}: {
  saving: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex min-h-11 items-center rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm font-medium text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-60"
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
  );
}
