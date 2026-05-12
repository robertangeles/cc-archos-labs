"use client";

// Accessible modal dialog. Used for the slot-taken modal (D9) on /book.
//
// Implements the §17.9 spec:
//   - Desktop: centred dialog, max-w-440px, surface bg, rule border
//   - Mobile (<640px): full-width sheet sliding up from the bottom
//   - Backdrop: canvas/80 with backdrop-blur-sm
//   - Closes on Escape, on backdrop click, and when isOpen flips false
//   - Focus is trapped while open; restores focus to the opener on close
//
// Built on the native <dialog> element so the browser handles focus
// trap + scroll lock without us hand-rolling them. We layer our own
// backdrop + animations on top.

import { useEffect, useRef, type ReactNode } from "react";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // Optional id for screen-reader association with the title text.
  ariaLabelledBy?: string;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  ariaLabelledBy,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = ariaLabelledBy ?? "dialog-title";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isOpen && !el.open) el.showModal();
    if (!isOpen && el.open) el.close();
  }, [isOpen]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function handleCancel(event: Event) {
      event.preventDefault();
      onClose();
    }
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // The browser's native dialog ::backdrop pseudo doesn't apply
      // blur/colour the way we want, so we paint our own backdrop
      // inside this layer via a fixed inset div and rely on `dialog`
      // for focus trap + Esc handling.
      className="m-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-canvas/80 backdrop:backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="fixed inset-0 z-0 cursor-default bg-transparent"
        tabIndex={-1}
      />
      <div
        role="document"
        className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-[440px] rounded-t-lg border border-rule bg-surface p-8 motion-safe:animate-[slideup_200ms_ease-out] sm:bottom-auto sm:inset-y-1/2 sm:-translate-y-1/2 sm:rounded-lg"
      >
        <h2
          id={titleId}
          className="text-[24px] font-semibold leading-[1.25] tracking-[-0.01em] text-fg"
        >
          {title}
        </h2>
        <div className="mt-4 text-base leading-[1.7] text-muted">
          {children}
        </div>
      </div>
    </dialog>
  );
}
