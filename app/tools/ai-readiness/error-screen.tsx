"use client";

// Surfaced when /api/diagnostic/generate fails. Answers stay in
// localStorage so the user can retry without re-answering.

export function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="flex flex-1 items-center justify-center bg-canvas px-6 py-32 md:px-12">
      <div className="flex max-w-[480px] flex-col items-center gap-y-5 text-center">
        <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-muted">
          Something went wrong
        </p>
        <h2 className="text-2xl font-semibold leading-[1.2] tracking-[-0.01em] text-fg md:text-[28px]">
          {message}
        </h2>
        <p className="text-sm leading-[1.6] text-muted">
          Your answers are saved on your device. Try generating the
          report again — if it keeps failing, send us a note.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center rounded-md bg-accent px-7 py-3 text-base font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
