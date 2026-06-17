"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Database, FolderKanban, Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ModelCreate, OriginDirection } from "@/lib/model-studio/validation";
import { useModels, type DataModelSummary } from "@/hooks/use-models";

// ============================================================================
// CreateModelDialog — click "Start blank" or "New model" → this dialog.
//
// Migrated from Spresso (packages/client/src/components/model-studio/
// CreateModelDialog.tsx). The Infection-Virus design is preserved; the only
// changes are the design-token remap and the org-context adaptation.
//
// Token remap (Spresso → this repo, see iteration 6 notes):
//   accent (yellow #FFD60A)        → primary (Linear lavender #5e6ad2)
//   rgba(255,214,10,*) glow        → rgba(94,106,210,*) (= primary rgb)
//   text-text-primary              → text-ink
//   text-text-secondary            → text-ink-subtle
//   amber-600 / text-black on CTA  → primary-hover / text-white
//
// Org adaptation: Spresso let the user pick an organisation (multi-org) and
// filtered projects to it. This repo scopes everything to a single org via the
// `archos_org` cookie — `/api/projects` already returns only the active org's
// projects — so the organisation selector is removed entirely. The model's org
// is derived server-side from project.organisation_id (see validation.ts).
//
// Error handling is adapted to this repo's plain-Error convention: the hook's
// `create` throws a plain-language Error, so there is no axios `response.data`
// to read.
//
// Rendered via React portal. ESC always cancels.
// ============================================================================

interface ProjectOption {
  id: string;
  name: string;
}

interface ProjectsResponse {
  ok?: boolean;
  projects?: ProjectOption[];
}

export function CreateModelDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (model: DataModelSummary) => void;
}) {
  const { create } = useModels();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [originDirection, setOriginDirection] = useState<OriginDirection>("greenfield");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load the active org's projects when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch project options when the dialog opens
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/projects", { credentials: "same-origin" });
        const data = (await res.json().catch(() => null)) as ProjectsResponse | null;
        if (cancelled) return;
        const list = data?.projects ?? [];
        setProjects(list);
        if (list.length > 0) setSelectedProjectId(list[0].id);
      } catch {
        if (!cancelled) setError("Could not load your projects. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => nameInputRef.current?.focus(), 30);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form state when the dialog closes
      setName("");
      setDescription("");
      setOriginDirection("greenfield");
      setError(null);
    }
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const canSubmit =
    name.trim().length > 0 && !!selectedProjectId && !submitting && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmedDesc = description.trim();
      // Map origin direction to the layer the canvas should open on:
      // greenfield → conceptual (start conceptual), existing_system →
      // physical (start physical, reverse-engineering posture).
      const startingLayer = originDirection === "existing_system" ? "physical" : "conceptual";
      const payload: ModelCreate = {
        name: name.trim(),
        projectId: selectedProjectId,
        activeLayer: startingLayer,
        notation: "ie",
        originDirection,
        description: trimmedDesc.length > 0 ? trimmedDesc : null,
        metadata: {},
        tags: [],
      };
      const created = await create(payload);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create model");
    } finally {
      setSubmitting(false);
    }
  };

  const noProjects = !loading && projects.length === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-model-title"
      data-testid="create-model-dialog"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <form
        onSubmit={handleSubmit}
        className={[
          "relative z-10 w-full max-w-md rounded-2xl p-6",
          "bg-surface-2/80 backdrop-blur-xl border border-white/10",
          "shadow-[0_0_48px_rgba(94,106,210,0.15)]",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => !submitting && onClose()}
          className="absolute top-3 right-3 text-ink-subtle/70 hover:text-ink transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="relative">
            <div
              className="absolute inset-0 bg-primary/20 blur-xl rounded-full"
              aria-hidden="true"
            />
            <div className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 via-primary/5 to-transparent border border-primary/40 text-primary shadow-[0_0_12px_rgba(94,106,210,0.25)]">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div>
            <h2 id="create-model-title" className="text-base font-semibold text-ink">
              Start a new model
            </h2>
            <p className="text-xs text-ink-subtle">
              Pick the project this model belongs to. You can switch layers and notation later.
            </p>
          </div>
        </div>

        <FieldLabel icon={<Sparkles className="h-3 w-3" />} label="Starting from" />
        <div className="grid grid-cols-2 gap-2">
          <DirectionCard
            label="Greenfield"
            description="Start conceptual. Define entities first, then move down."
            icon={<Sparkles className="h-3.5 w-3.5" />}
            selected={originDirection === "greenfield"}
            onClick={() => setOriginDirection("greenfield")}
          />
          <DirectionCard
            label="Existing system"
            description="Start physical. Reverse-engineer first, then build upward."
            icon={<Database className="h-3.5 w-3.5" />}
            selected={originDirection === "existing_system"}
            onClick={() => setOriginDirection("existing_system")}
          />
        </div>

        <div className="mt-4" />
        <FieldLabel icon={<FolderKanban className="h-3 w-3" />} label="Project" />
        {loading ? (
          <StaticChip label="Loading…" />
        ) : noProjects ? (
          <ErrorChip label="No projects yet. Create one in Projects first." />
        ) : (
          <SelectField
            value={selectedProjectId}
            onChange={setSelectedProjectId}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}

        <div className="mt-4" />
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
            Model name
          </span>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="e.g. Customer Domain Model"
            data-testid="create-model-name"
            className={[
              "w-full rounded-lg px-3 py-2 text-sm",
              "bg-surface-1/60 border border-white/10 text-ink",
              "placeholder:text-ink-subtle/40",
              "focus:outline-none focus:border-primary/50 focus:shadow-[0_0_12px_rgba(94,106,210,0.15)]",
              "transition-all",
            ].join(" ")}
            required
          />
        </label>

        <div className="mt-4" />
        <label className="block">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="block text-[11px] uppercase tracking-wider text-ink-subtle/80">
              Description{" "}
              <span className="normal-case tracking-normal text-ink-subtle/50">(optional)</span>
            </span>
            <span className="text-[10px] text-ink-subtle/50 tabular-nums">
              {description.length} / 2,000
            </span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder="What does this model capture? Who relies on it? Notes for future-you and anyone else inheriting it."
            className={[
              "w-full rounded-lg px-3 py-2 text-sm resize-y min-h-[84px] max-h-[220px]",
              "bg-surface-1/60 border border-white/10 text-ink",
              "placeholder:text-ink-subtle/40",
              "focus:outline-none focus:border-primary/50 focus:shadow-[0_0_12px_rgba(94,106,210,0.15)]",
              "transition-all",
            ].join(" ")}
          />
        </label>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="mt-5 flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="rounded-lg px-4 py-2 text-sm text-ink-subtle hover:text-ink hover:bg-surface-1/50 transition-colors disabled:opacity-50"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="create-model-submit"
            className={[
              "inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold",
              "bg-gradient-to-r from-primary to-primary-hover text-white",
              "shadow-[0_0_12px_rgba(94,106,210,0.25)]",
              "hover:shadow-[0_0_24px_rgba(94,106,210,0.4)]",
              "transition-all disabled:opacity-60 disabled:cursor-not-allowed",
            ].join(" ")}
          >
            {submitting ? "Creating…" : "Create model"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function FieldLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-subtle/80 mb-1.5">
      {icon}
      {label}
    </span>
  );
}

function StaticChip({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm bg-surface-1/40 border border-white/5 text-ink">
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function ErrorChip({ label }: { label: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-sm bg-surface-1/40 border border-white/5 text-red-300/80">
      {label}
    </div>
  );
}

function DirectionCard({
  label,
  description,
  icon,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`direction-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={[
        "group rounded-lg border px-3 py-2.5 text-left transition-all",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        selected
          ? "border-primary/60 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent shadow-[0_0_18px_rgba(94,106,210,0.25)]"
          : "border-white/10 bg-surface-1/40 hover:border-white/20 hover:-translate-y-0.5 hover:shadow-md",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span
          className={[
            "inline-flex h-6 w-6 items-center justify-center rounded-md border",
            selected
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-white/10 bg-surface-2/40 text-ink-subtle group-hover:text-ink",
          ].join(" ")}
        >
          {icon}
        </span>
        <span
          className={["text-xs font-semibold", selected ? "text-ink" : "text-ink/90"].join(" ")}
        >
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-subtle">{description}</p>
    </button>
  );
}

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="create-model-project"
      className={[
        "w-full rounded-lg px-3 py-2 text-sm",
        "bg-surface-1/60 border border-white/10 text-ink",
        "focus:outline-none focus:border-primary/50 focus:shadow-[0_0_12px_rgba(94,106,210,0.15)]",
        "transition-all",
      ].join(" ")}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
