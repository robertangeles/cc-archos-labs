"use client";

import { useMemo } from "react";
import type { ZodTypeAny } from "zod";
import {
  classifySchema,
  type FieldDescriptor,
} from "../../../../lib/pages/blocks/field-introspection";

// ZodForm — recursive renderer driven by a Zod schema's introspected
// FieldDescriptor tree. Used by BlocksEditor to replace the raw-JSON
// editor with labelled per-field inputs.
//
// Contract:
//   - schema: the Zod schema for the value the user is editing (a
//     block's props, typically z.object({...}))
//   - value:  the current value (may be partial; the form fills in
//     missing keys with sensible defaults at render time so the user
//     sees every field)
//   - onChange: called with the updated value on every keystroke
//
// Value is typed as `Record<string, unknown>` at the boundary. The
// caller's save path validates against the schema again (defense in
// depth — the form's "valid as you type" is a UX hint, not a guarantee).
//
// What it cannot render:
//   - Union / intersection / tuple / record / transform — fall through
//     to a "Edit as JSON" hint per field. Switch to the BlocksEditor's
//     "Show as JSON" toggle for those blocks.

interface ZodFormProps {
  schema: ZodTypeAny;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function ZodForm({ schema, value, onChange }: ZodFormProps) {
  const descriptor = useMemo(() => classifySchema(schema), [schema]);
  if (descriptor.kind !== "object") {
    return (
      <UnsupportedHint
        message="Top-level schema is not an object — per-field editor only supports object schemas. Use the JSON editor."
      />
    );
  }
  return (
    <div className="space-y-5">
      {Object.entries(descriptor.fields).map(([key, field]) => (
        <FieldRow
          key={key}
          name={key}
          field={field}
          value={value[key]}
          onChange={(next) =>
            onChange({
              ...value,
              [key]: next,
            })
          }
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldRow — one labelled row in the form.
// ---------------------------------------------------------------------------

interface FieldRowProps {
  name: string;
  field: FieldDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Used for nested array/object children so the label nests visually. */
  depth?: number;
}

function FieldRow({ name, field, value, onChange, depth = 0 }: FieldRowProps) {
  const label = humanLabel(name);
  const labelEl = (
    <div className="flex items-baseline justify-between">
      <label className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
        {label}
        {!field.required ? (
          <span className="ml-2 text-[10px] normal-case text-ink-subtle/60">
            optional
          </span>
        ) : null}
      </label>
      <CharCounter field={field} value={value} />
    </div>
  );

  switch (field.kind) {
    case "string":
      return (
        <div>
          {labelEl}
          <input
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            className={inputClass()}
            maxLength={field.max}
            placeholder={field.required ? "" : "Optional"}
          />
        </div>
      );
    case "longString":
      return (
        <div>
          {labelEl}
          <textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            className={`${inputClass()} min-h-[120px] font-mono text-[13px]`}
            maxLength={field.max}
            placeholder={field.required ? "" : "Optional"}
          />
        </div>
      );
    case "number":
      return (
        <div>
          {labelEl}
          <input
            type="number"
            value={typeof value === "number" ? value : ""}
            onChange={(e) => {
              const n = e.target.value;
              onChange(n === "" ? undefined : Number(n));
            }}
            className={inputClass()}
            min={field.min}
            max={field.max}
          />
        </div>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-x-3 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{label}</span>
        </label>
      );
    case "enum":
      return (
        <div>
          {labelEl}
          <select
            value={typeof value === "string" ? value : field.options[0]}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass()}
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    case "literal":
      return (
        <div>
          {labelEl}
          <p className="mt-1 text-[12px] text-ink-subtle">
            Fixed value: <code>{String(field.value)}</code>
          </p>
        </div>
      );
    case "object":
      return (
        <ObjectField
          name={name}
          field={field}
          value={value}
          onChange={onChange}
          depth={depth}
        />
      );
    case "array":
      return (
        <ArrayField
          name={name}
          field={field}
          value={value}
          onChange={onChange}
          depth={depth}
        />
      );
    case "unknown":
      return (
        <div>
          {labelEl}
          <UnsupportedHint message={field.reason} />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// ObjectField — nested object renders as an indented card.
// ---------------------------------------------------------------------------

function ObjectField({
  name,
  field,
  value,
  onChange,
  depth,
}: {
  name: string;
  field: Extract<FieldDescriptor, { kind: "object" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  depth: number;
}) {
  const safeValue =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  // Optional object that the user hasn't filled in yet: show an "Add" CTA.
  if (!field.required && Object.keys(safeValue).length === 0) {
    return (
      <div>
        <label className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
          {humanLabel(name)}
          <span className="ml-2 text-[10px] normal-case text-ink-subtle/60">
            optional · not set
          </span>
        </label>
        <button
          type="button"
          onClick={() => {
            // Seed each child field with a sensible empty value so the
            // form has something to bind to.
            const seed: Record<string, unknown> = {};
            for (const [k, f] of Object.entries(field.fields)) {
              if (f.required) seed[k] = defaultFor(f);
            }
            onChange(seed);
          }}
          className="mt-2 rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-subtle hover:border-primary hover:text-ink"
        >
          + Add {humanLabel(name).toLowerCase()}
        </button>
      </div>
    );
  }

  return (
    <fieldset className="rounded-md border border-hairline bg-surface-1 p-4">
      <legend className="px-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
        {humanLabel(name)}
        {!field.required ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ml-3 text-[10px] normal-case text-red-500 hover:underline"
          >
            remove
          </button>
        ) : null}
      </legend>
      <div className="space-y-4">
        {Object.entries(field.fields).map(([key, child]) => (
          <FieldRow
            key={key}
            name={key}
            field={child}
            value={safeValue[key]}
            onChange={(next) => {
              if (next === undefined) {
                const copy = { ...safeValue };
                delete copy[key];
                onChange(copy);
              } else {
                onChange({ ...safeValue, [key]: next });
              }
            }}
            depth={depth + 1}
          />
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// ArrayField — list of items with Up/Down/Remove + Add.
// ---------------------------------------------------------------------------

function ArrayField({
  name,
  field,
  value,
  onChange,
  depth,
}: {
  name: string;
  field: Extract<FieldDescriptor, { kind: "array" }>;
  value: unknown;
  onChange: (next: unknown) => void;
  depth: number;
}) {
  const safeArr = Array.isArray(value) ? (value as unknown[]) : [];
  const canAdd =
    field.maxItems === undefined || safeArr.length < field.maxItems;
  const canRemove =
    field.minItems === undefined || safeArr.length > field.minItems;

  function update(next: unknown[]) {
    onChange(next);
  }

  return (
    <fieldset className="rounded-md border border-hairline bg-surface-1 p-4">
      <legend className="px-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
        {humanLabel(name)} ({safeArr.length}
        {field.maxItems !== undefined ? ` / ${field.maxItems}` : ""})
      </legend>
      {safeArr.length === 0 ? (
        <p className="text-[12px] text-ink-subtle">
          No items yet. Click + Add to start.
        </p>
      ) : (
        <ol className="space-y-3">
          {safeArr.map((item, idx) => (
            <li
              key={idx}
              className="rounded-md border border-hairline bg-canvas p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] tabular-nums text-ink-subtle">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="flex items-center gap-x-1 text-[12px]">
                  <button
                    type="button"
                    onClick={() =>
                      idx > 0 &&
                      update(swap(safeArr, idx, idx - 1))
                    }
                    disabled={idx === 0}
                    className="rounded px-2 py-0.5 text-ink-subtle hover:text-ink disabled:opacity-30"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      idx < safeArr.length - 1 &&
                      update(swap(safeArr, idx, idx + 1))
                    }
                    disabled={idx === safeArr.length - 1}
                    className="rounded px-2 py-0.5 text-ink-subtle hover:text-ink disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      canRemove &&
                      update(safeArr.filter((_, i) => i !== idx))
                    }
                    disabled={!canRemove}
                    className="rounded px-2 py-0.5 text-red-500 hover:bg-red-500/10 disabled:opacity-30"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <FieldRow
                name={`${name}_item`}
                field={field.itemDescriptor}
                value={item}
                onChange={(next) =>
                  update(safeArr.map((x, i) => (i === idx ? next : x)))
                }
                depth={depth + 1}
              />
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        onClick={() => update([...safeArr, defaultFor(field.itemDescriptor)])}
        disabled={!canAdd}
        className="mt-3 rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-subtle hover:border-primary hover:text-ink disabled:opacity-30"
      >
        + Add {humanLabel(name).toLowerCase().replace(/s$/, "") || "item"}
      </button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function inputClass(): string {
  return "mt-2 w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/60 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";
}

function humanLabel(name: string): string {
  // camelCase or snake_case → "Title Case With Spaces"
  return name
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = [...arr];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

function defaultFor(field: FieldDescriptor): unknown {
  switch (field.kind) {
    case "string":
    case "longString":
      return "";
    case "number":
      return field.min ?? 0;
    case "boolean":
      return false;
    case "enum":
      return field.options[0];
    case "literal":
      return field.value;
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(field.fields)) {
        if (f.required) out[k] = defaultFor(f);
      }
      return out;
    }
    case "array":
      return [];
    case "unknown":
      return null;
  }
}

function CharCounter({
  field,
  value,
}: {
  field: FieldDescriptor;
  value: unknown;
}) {
  if (field.kind !== "string" && field.kind !== "longString") return null;
  if (field.max === undefined) return null;
  const len = typeof value === "string" ? value.length : 0;
  const over = len > field.max * 0.9 && len < field.max;
  const atMax = len === field.max;
  return (
    <span
      className={`text-[10px] tabular-nums ${
        atMax
          ? "text-red-500"
          : over
            ? "text-amber-600 dark:text-amber-400"
            : "text-ink-subtle/60"
      }`}
    >
      {len} / {field.max}
    </span>
  );
}

function UnsupportedHint({ message }: { message: string }) {
  return (
    <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-800 dark:text-amber-200">
      {message}
    </p>
  );
}
