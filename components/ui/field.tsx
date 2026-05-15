// Labelled form field — text, email, or textarea — matching the styles
// already in components/contact/contact-form.tsx. Label is the small
// uppercase muted style; the input itself has the canvas background +
// rule border + focus-accent treatment. Error state shows a red border
// and a calm red-400 helper line below per plan §17.9.

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

const labelClass =
  "text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle";

const baseInputClass =
  "w-full rounded-md border bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-subtle/60 transition-colors duration-150 focus:outline-none";

const borderClass = "border-hairline focus:border-primary";
const errorBorderClass = "border-red-500/40 focus:border-red-500/60";

type CommonProps = {
  label: string;
  hint?: string;
  error?: string;
};

export type FieldProps = CommonProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "type"> & {
    name: string;
    type?: Exclude<InputHTMLAttributes<HTMLInputElement>["type"], "textarea">;
    multiline?: false;
  };

export type TextareaFieldProps = CommonProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name"> & {
    name: string;
    multiline: true;
    rows?: number;
  };

// One component, two shapes. `multiline: true` switches to <textarea>;
// otherwise <input>. Keeps the call sites consistent.
export const Field = forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  FieldProps | TextareaFieldProps
>(function Field(props, ref) {
  const { label, hint, error, name, className = "", ...rest } = props;
  const isMultiline = "multiline" in props && props.multiline === true;
  const inputId = `field-${name}`;
  const hintId = hint || error ? `${inputId}-hint` : undefined;
  const stateClass = error ? errorBorderClass : borderClass;
  const inputClass = `${baseInputClass} ${stateClass} ${className}`;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className={labelClass}>
        {label}
      </label>
      {isMultiline ? (
        <textarea
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          ref={ref as React.Ref<HTMLTextAreaElement>}
          id={inputId}
          name={name}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          rows={(props as TextareaFieldProps).rows ?? 4}
          className={inputClass}
        />
      ) : (
        <input
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
          ref={ref as React.Ref<HTMLInputElement>}
          id={inputId}
          name={name}
          type={(props as FieldProps).type ?? "text"}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          className={inputClass}
        />
      )}
      {error ? (
        <p id={hintId} className="text-sm text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
