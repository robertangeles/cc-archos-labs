"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  ImagePlus,
  Code2,
  Sparkles,
  PlusSquare,
  Power,
  Plus,
  ArrowRight,
  Building2,
  Briefcase,
  FolderKanban,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useModelStudioFlag } from "@/hooks/use-model-studio-flag";
import { useModels, type DataModelSummary } from "@/hooks/use-models";
import { CreateModelDialog } from "@/components/model-studio/create-model-dialog";
import { EditModelDialog } from "@/components/model-studio/edit-model-dialog";
import { DeleteModelDialog } from "@/components/model-studio/delete-model-dialog";

// ============================================================================
// ModelStudioView — Model Studio LIST VIEW (the convergence point).
//
// Migrated from Spresso (packages/client/src/pages/ModelStudioPage.tsx) and
// ADAPTED to this repo's conventions:
//   - react-router useNavigate → next/navigation useRouter; navigation targets
//     rebased to /workspace/model-studio/<id> (the detail route in this repo).
//   - Spresso's useAuth (`user.role === 'Administrator'`) → this repo's per-org
//     role: the current org's role is read from /api/organisations (default-org
//     first, matching org-management.tsx), and the admin "Enable" button shows
//     for owner|admin. The flag PUT is server-gated to owner|admin regardless.
//   - Spresso's useToast success toasts are dropped — this repo has no toast
//     library; the dialogs close on success and the optimistic hook + refresh
//     reconcile the list (mirroring components/projects/projects-view.tsx).
//   - Design-token remap (see iteration 6/7 notes): accent (yellow #FFD60A) →
//     primary (Linear lavender #5e6ad2), rgba(255,214,10,*) glow →
//     rgba(94,106,210,*), text-text-primary → text-ink, text-text-secondary →
//     text-ink-subtle, from-accent/to-amber-600/text-black CTA →
//     from-primary/to-primary-hover/text-white. All other Spresso tokens kept.
//
// States:
//   - Flag OFF / loading → "Coming soon" stub. owner|admin see an Enable button.
//   - Flag ON:
//     • 0 models  → empty state with three quick-start cards. "Start blank" is
//                   live; "From a whiteboard" / "From a query" stay gated.
//     • ≥1 models → model library grid + "New model" button.
//
// Hooks above any conditional return (lesson: stable hook order).
// ============================================================================

interface OrgSummary {
  role: "owner" | "admin" | "member";
}
interface OrgsResponse {
  ok?: boolean;
  organisations?: OrgSummary[];
}

export function ModelStudioView() {
  const { enabled, isLoading: flagLoading, setEnabled } = useModelStudioFlag();

  // The current org's role drives the admin "Enable" button. The first org in
  // /api/organisations is the active one (default-org-first ordering, matching
  // org-management.tsx). Fail closed: assume non-admin until proven otherwise.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/organisations", { credentials: "same-origin" });
        const data = (await res.json().catch(() => null)) as OrgsResponse | null;
        const role = data?.organisations?.[0]?.role;
        if (!cancelled) setIsAdmin(role === "owner" || role === "admin");
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Call useModels unconditionally to keep hook order stable even when the flag
  // is OFF (its initial fetch short-circuits via the gated API, harmlessly).
  const { models, total, isLoading: modelsLoading, refresh, update, remove } = useModels();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<DataModelSummary | null>(null);
  const [deletingModel, setDeletingModel] = useState<DataModelSummary | null>(null);
  const router = useRouter();

  const handleCreated = (m: DataModelSummary) => {
    setDialogOpen(false);
    refresh();
    router.push(`/workspace/model-studio/${m.id}`);
  };

  const handleSaveEdit = async (patch: { name?: string; description?: string | null }) => {
    if (!editingModel) return;
    await update(editingModel.id, patch);
    void refresh();
  };

  const handleDeleteConfirmed = async (id: string) => {
    await remove(id);
    void refresh();
  };

  if (flagLoading || !enabled) {
    return <ComingSoonStub isAdmin={isAdmin} onEnable={() => setEnabled(true)} />;
  }

  // Three states — do NOT render the empty state while the count is unknown,
  // otherwise the "Start blank / Whiteboard / Query" landing flashes every time
  // the user navigates back from a detail page.
  const view = modelsLoading ? "loading" : total > 0 ? "list" : "empty";

  return (
    <>
      {view === "loading" && <LoadingSkeleton />}
      {view === "list" && (
        <ModelsLibraryView
          models={models}
          total={total}
          onCreateClick={() => setDialogOpen(true)}
          onOpen={(id) => router.push(`/workspace/model-studio/${id}`)}
          onEdit={(m) => setEditingModel(m)}
          onDelete={(m) => setDeletingModel(m)}
        />
      )}
      {view === "empty" && <ModelStudioEmptyState onStartBlank={() => setDialogOpen(true)} />}
      <CreateModelDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
      <EditModelDialog
        model={editingModel}
        onClose={() => setEditingModel(null)}
        onSave={handleSaveEdit}
      />
      <DeleteModelDialog
        model={deletingModel}
        onClose={() => setDeletingModel(null)}
        onDelete={handleDeleteConfirmed}
      />
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="relative mx-auto flex h-full max-w-6xl flex-col gap-6 px-6 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_top,_rgba(94,106,210,0.08),_transparent_70%)]"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-40 rounded-2xl border border-white/5 bg-surface-2/30 backdrop-blur animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function ComingSoonStub({
  isAdmin,
  onEnable,
}: {
  isAdmin: boolean;
  onEnable: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleEnable = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onEnable();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to enable");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-20">
      <div className="relative">
        <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" aria-hidden="true" />
        <div className="relative p-4 rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-transparent border border-primary/30 shadow-[0_0_24px_rgba(94,106,210,0.15)]">
          <Boxes className="h-8 w-8 text-primary" />
        </div>
      </div>
      <div className="text-center max-w-md">
        <h1 className="text-xl font-bold tracking-tight text-ink">Model Studio</h1>
        <p className="mt-2 text-sm text-ink-subtle">
          Data modelling workspace — conceptual, logical, and physical layers aligned to DMBOK.
          Coming soon.
        </p>
      </div>
      {isAdmin && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className={[
              "group relative inline-flex items-center gap-2 rounded-xl px-5 py-2.5",
              "bg-gradient-to-r from-primary to-primary-hover text-white font-semibold text-sm",
              "shadow-[0_0_12px_rgba(94,106,210,0.25)]",
              "transition-all duration-300 ease-out",
              "hover:-translate-y-0.5 hover:shadow-[0_0_24px_rgba(94,106,210,0.4)]",
              "disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0",
            ].join(" ")}
          >
            <Power className="h-4 w-4" />
            {busy ? "Enabling…" : "Enable Model Studio"}
          </button>
          <span className="text-[10px] uppercase tracking-wider text-ink-subtle/60">
            Admin only · persists across sessions
          </span>
          {err && <span className="text-xs text-red-400">{err}</span>}
        </div>
      )}
    </div>
  );
}

function ModelStudioEmptyState({ onStartBlank }: { onStartBlank: () => void }) {
  return (
    <div className="relative mx-auto flex h-full max-w-5xl flex-col items-center justify-center gap-10 px-6 py-16">
      {/* Ambient gradient behind the hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,_rgba(94,106,210,0.12),_transparent_70%)]"
      />

      <div className="relative flex flex-col items-center gap-5">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/30 blur-3xl rounded-full" aria-hidden="true" />
          <div className="relative p-5 rounded-2xl bg-gradient-to-br from-primary/25 via-primary/5 to-transparent border border-primary/40 shadow-[0_0_36px_rgba(94,106,210,0.25)]">
            <Boxes className="h-10 w-10 text-primary" />
          </div>
        </div>

        <div className="text-center max-w-xl">
          <h1 className="bg-gradient-to-r from-ink to-primary bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            Model Studio
          </h1>
          <p className="mt-3 text-sm text-ink-subtle">
            A thinking surface for data architects. Conceptual, logical, and physical layers —
            linked, not duplicated. DDL that respects your craft. AI that pair-models with you.
          </p>
        </div>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-3">
        <QuickStartCard
          icon={<PlusSquare className="h-5 w-5" />}
          title="Start blank"
          description="Fresh conceptual model. Add entities, draw relationships, export DDL when ready."
          hint="Click to begin"
          onClick={onStartBlank}
          live
        />
        <QuickStartCard
          icon={<ImagePlus className="h-5 w-5" />}
          title="From a whiteboard"
          description="Drop a photo of any ER diagram or whiteboard — we draft the model for you."
          hint="Coming soon"
          accent
        />
        <QuickStartCard
          icon={<Code2 className="h-5 w-5" />}
          title="From a query"
          description="Paste a SELECT query. We'll suggest the entities and attributes it implies."
          hint="Coming soon"
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-ink-subtle/80">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span>AI-native · keyboard-first · plugin-ready · DMBOK-aligned</span>
      </div>
    </div>
  );
}

function QuickStartCard({
  icon,
  title,
  description,
  hint,
  accent = false,
  live = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  hint: string;
  accent?: boolean;
  live?: boolean;
  onClick?: () => void;
}) {
  const interactive = live && !!onClick;
  const className = [
    "group relative flex flex-col gap-3 rounded-2xl border p-5 text-left",
    "bg-surface-2/50 backdrop-blur border-white/5",
    "transition-all duration-300 ease-out",
    interactive
      ? "cursor-pointer hover:-translate-y-1 hover:border-primary/60 hover:shadow-[0_0_32px_rgba(94,106,210,0.28)]"
      : "hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_0_24px_rgba(94,106,210,0.18)]",
    accent ? "ring-1 ring-primary/20" : "",
    interactive ? "ring-1 ring-primary/40" : "",
  ].join(" ");

  const inner = (
    <>
      <div
        className={[
          "inline-flex h-9 w-9 items-center justify-center rounded-xl",
          "bg-gradient-to-br from-primary/20 via-primary/5 to-transparent",
          "border border-primary/30 text-primary",
          "shadow-[0_0_12px_rgba(94,106,210,0.15)]",
        ].join(" ")}
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="text-xs leading-relaxed text-ink-subtle">{description}</p>
      <span
        className={[
          "mt-auto text-[10px] uppercase tracking-wider",
          interactive ? "text-primary" : "text-ink-subtle/60",
        ].join(" ")}
      >
        {hint}
      </span>
    </>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

// ============================================================
// Models library — stratified by Organisation → Client → Project → Model.
// The hierarchy is the dominant design element: data architects live by
// provenance, and this layout makes "who owns this model" readable at a glance
// from the top of the page.
// ============================================================

interface GroupByProject {
  projectId: string;
  projectName: string;
  models: DataModelSummary[];
}
interface GroupByClient {
  clientId: string | null;
  clientName: string | null; // null → "Direct under Organisation"
  organisationName: string | null;
  projects: GroupByProject[];
  modelCount: number;
}

function groupModels(models: DataModelSummary[]): GroupByClient[] {
  // Bucket by clientId (null becomes its own bucket), preserving the first-seen
  // org name per bucket so headers stay stable.
  const clientMap = new Map<string, GroupByClient>();
  for (const m of models) {
    const key = m.clientId ?? "__no_client__";
    let bucket = clientMap.get(key);
    if (!bucket) {
      bucket = {
        clientId: m.clientId ?? null,
        clientName: m.clientName ?? null,
        organisationName: null,
        projects: [],
        modelCount: 0,
      };
      clientMap.set(key, bucket);
    }
    let proj = bucket.projects.find((p) => p.projectId === m.projectId);
    if (!proj) {
      proj = { projectId: m.projectId, projectName: m.projectName, models: [] };
      bucket.projects.push(proj);
    }
    proj.models.push(m);
    bucket.modelCount++;
  }
  // Stable sort: clients with a name first (alphabetical), "no client" last.
  return Array.from(clientMap.values()).sort((a, b) => {
    if (a.clientName && !b.clientName) return -1;
    if (!a.clientName && b.clientName) return 1;
    return (a.clientName ?? "").localeCompare(b.clientName ?? "");
  });
}

function ModelsLibraryView({
  models,
  total,
  onCreateClick,
  onOpen,
  onEdit,
  onDelete,
}: {
  models: DataModelSummary[];
  total: number;
  onCreateClick: () => void;
  onOpen: (id: string) => void;
  onEdit: (m: DataModelSummary) => void;
  onDelete: (m: DataModelSummary) => void;
}) {
  const groups = groupModels(models);
  const clientCount = groups.filter((g) => g.clientName).length;
  const projectCount = groups.reduce((acc, g) => acc + g.projects.length, 0);

  return (
    <div className="relative mx-auto flex h-full max-w-6xl flex-col gap-10 px-6 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_top,_rgba(94,106,210,0.08),_transparent_70%)]"
      />

      <header className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 via-primary/5 to-transparent border border-primary/40 text-primary shadow-[0_0_12px_rgba(94,106,210,0.2)]">
            <Boxes className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-ink">Model Studio</h1>
            <p className="text-[11px] uppercase tracking-wider text-ink-subtle/70 tabular-nums">
              {total} {total === 1 ? "model" : "models"}
              {clientCount > 0 && (
                <>
                  <span className="mx-1.5 text-ink-subtle/40">·</span>
                  {clientCount} {clientCount === 1 ? "client" : "clients"}
                </>
              )}
              <span className="mx-1.5 text-ink-subtle/40">·</span>
              {projectCount} {projectCount === 1 ? "project" : "projects"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCreateClick}
          className={[
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold",
            "bg-gradient-to-r from-primary to-primary-hover text-white",
            "shadow-[0_0_12px_rgba(94,106,210,0.25)]",
            "transition-all duration-200",
            "hover:-translate-y-0.5 hover:shadow-[0_0_24px_rgba(94,106,210,0.4)]",
          ].join(" ")}
        >
          <Plus className="h-4 w-4" />
          New model
        </button>
      </header>

      {groups.map((g, i) => (
        <ClientSection
          key={g.clientId ?? `no-client-${i}`}
          group={g}
          onOpen={onOpen}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function ClientSection({
  group,
  onOpen,
  onEdit,
  onDelete,
}: {
  group: GroupByClient;
  onOpen: (id: string) => void;
  onEdit: (m: DataModelSummary) => void;
  onDelete: (m: DataModelSummary) => void;
}) {
  const displayLabel = group.clientName ?? "Direct under organisation";
  return (
    <section className="relative flex flex-col gap-5">
      {/* Client header — primary dot + uppercase + hairline divider */}
      <div className="flex items-center gap-3">
        <span
          className={[
            "inline-flex h-1.5 w-1.5 rounded-full shrink-0",
            group.clientName
              ? "bg-primary shadow-[0_0_8px_rgba(94,106,210,0.6)]"
              : "bg-ink-subtle/40",
          ].join(" ")}
          aria-hidden="true"
        />
        <div className="flex items-baseline gap-2 min-w-0">
          {group.clientName ? (
            <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
          ) : (
            <Building2 className="h-3.5 w-3.5 text-ink-subtle/60 shrink-0" />
          )}
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/90 truncate">
            {displayLabel}
          </h2>
          {group.organisationName && group.clientName && (
            <span className="text-[10px] uppercase tracking-wider text-ink-subtle/50 truncate">
              · {group.organisationName}
            </span>
          )}
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
        <span className="text-[10px] uppercase tracking-wider text-ink-subtle/60 tabular-nums shrink-0">
          {group.projects.length} {group.projects.length === 1 ? "project" : "projects"}
          <span className="mx-1 text-ink-subtle/40">·</span>
          {group.modelCount} {group.modelCount === 1 ? "model" : "models"}
        </span>
      </div>

      <div className="flex flex-col gap-8 pl-4 border-l border-white/5">
        {group.projects.map((p) => (
          <ProjectShelf
            key={p.projectId}
            project={p}
            onOpen={onOpen}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectShelf({
  project,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: GroupByProject;
  onOpen: (id: string) => void;
  onEdit: (m: DataModelSummary) => void;
  onDelete: (m: DataModelSummary) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-ink-subtle">
        <FolderKanban className="h-3.5 w-3.5 text-primary/70" />
        <h3 className="text-xs font-semibold text-ink/90 truncate">{project.projectName}</h3>
        <span className="text-[10px] uppercase tracking-wider text-ink-subtle/50 tabular-nums">
          {project.models.length} {project.models.length === 1 ? "model" : "models"}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {project.models.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
            onOpen={() => onOpen(m.id)}
            onEdit={() => onEdit(m)}
            onDelete={() => onDelete(m)}
          />
        ))}
      </div>
    </div>
  );
}

function ModelCard({
  model,
  onOpen,
  onEdit,
  onDelete,
}: {
  model: DataModelSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const layerColor =
    model.activeLayer === "conceptual"
      ? "text-amber-300 border-amber-300/30 bg-amber-300/5"
      : model.activeLayer === "logical"
        ? "text-sky-300 border-sky-300/30 bg-sky-300/5"
        : "text-emerald-300 border-emerald-300/30 bg-emerald-300/5";

  // Card is a div (not button) so the kebab menu can live inside without nesting
  // interactive elements. Keyboard users get a focusable region + Enter/Space.
  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKey}
      className={[
        "group relative flex flex-col gap-3 rounded-2xl border p-5 text-left min-h-[172px]",
        "bg-surface-2/50 backdrop-blur border-white/5 cursor-pointer",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_0_24px_rgba(94,106,210,0.18)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <span
          className={[
            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
            layerColor,
          ].join(" ")}
        >
          {model.activeLayer}
        </span>
        <div className="flex items-center gap-1">
          <ModelCardMenu onEdit={onEdit} onDelete={onDelete} />
          <ArrowRight className="h-3.5 w-3.5 text-ink-subtle/40 group-hover:text-primary transition-colors" />
        </div>
      </div>

      <h3 className="text-sm font-semibold text-ink line-clamp-1 leading-snug">{model.name}</h3>

      {model.description ? (
        <p className="text-xs text-ink-subtle leading-relaxed line-clamp-3">{model.description}</p>
      ) : (
        <p className="text-xs italic text-ink-subtle/40 leading-relaxed line-clamp-3">
          No description yet. Hover over models without a description to spot them — auto-describe
          arrives with entities.
        </p>
      )}

      <div className="mt-auto flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-subtle/60">
        <span className="truncate">
          {model.ownerName ? `by ${model.ownerName}` : model.notation}
        </span>
        <span className="tabular-nums">{relativeTime(model.updatedAt)}</span>
      </div>
    </div>
  );
}

/**
 * Kebab menu per model card — Edit / Delete. Hidden in resting state, revealed
 * on hover/focus, so the card surface stays uncluttered for the library view.
 * stopPropagation on every click so the parent card's navigation doesn't fire.
 */
function ModelCardMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div ref={ref} className="relative" onClick={stop} onKeyDown={stop}>
      <button
        type="button"
        aria-label="Model actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="model-card-menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={[
          "inline-flex h-6 w-6 items-center justify-center rounded-md",
          "text-ink-subtle/60 hover:text-ink hover:bg-surface-1/50",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          "transition-opacity",
          open ? "opacity-100 bg-surface-1/50 text-ink" : "",
        ].join(" ")}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className={[
            "absolute right-0 top-7 z-30 w-40 overflow-hidden rounded-lg",
            "bg-surface-2 border border-white/10",
            "shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
          ].join(" ")}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="model-card-edit"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onEdit();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink hover:bg-surface-1/60 transition-colors"
          >
            <Pencil className="h-3 w-3 text-ink-subtle" />
            Edit model
          </button>
          <div className="h-px bg-white/5" />
          <button
            type="button"
            role="menuitem"
            data-testid="model-card-delete"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Delete model
          </button>
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
