"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";
import { Section } from "../../sections/home/section";
import {
  GOVERNANCE,
  SECTORS,
  STAGES,
  diagnose,
  type GovernanceId,
  type SectorId,
  type StageId,
} from "../../../lib/pages/blocks/quick-diagnosis-logic";
import type { QuickDiagnosisBlockProps } from "../../../lib/pages/blocks/schemas";

// Quick Diagnosis block — matches home page Section patterns. Heading
// at text-display-md ink, body at text-body-lg ink-subtle. Three
// numbered question groups with pill options. Output panel uses the
// home page ProofItem treatment (surface-1 + hairline border + lavender
// top stroke) so it reads as a card in the same family as the rest of
// the page, not a special component.

export function QuickDiagnosisBlock(props: QuickDiagnosisBlockProps) {
  const [sector, setSector] = useState<SectorId | null>(null);
  const [stage, setStage] = useState<StageId | null>(null);
  const [governance, setGovernance] = useState<GovernanceId | null>(null);

  const allAnswered = sector && stage && governance;
  const diagnosisText = allAnswered
    ? diagnose({ sector, stage, governance })
    : null;

  return (
    <Section bg="surface-1">
      <h2 className="text-display-md text-ink">{props.heading}</h2>
      <p className="mt-5 max-w-[640px] text-body-lg text-ink-subtle">
        {props.subtext}
      </p>

      <div className="mt-12 space-y-16 md:space-y-20">
        <NumberedQuestion
          number={1}
          question="What sector are you in?"
          value={sector}
          options={SECTORS}
          onSelect={(id) => setSector(id as SectorId)}
        />
        <NumberedQuestion
          number={2}
          question="Where is your AI program right now?"
          value={stage}
          options={STAGES}
          onSelect={(id) => setStage(id as StageId)}
        />
        <NumberedQuestion
          number={3}
          question="What does your data governance look like in practice — not on paper?"
          value={governance}
          options={GOVERNANCE}
          onSelect={(id) => setGovernance(id as GovernanceId)}
        />
      </div>

      {diagnosisText ? (
        <DiagnosisCard
          text={diagnosisText}
          disclaimer={props.disclaimer}
          primaryCta={props.primaryCta}
          secondaryCta={props.secondaryCta}
        />
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// NumberedQuestion — eyebrow numeral + body-lg question + pill options.
// Same scale as the home page proof + service cards.
// ---------------------------------------------------------------------------

interface NumberedQuestionProps<T extends string> {
  number: number;
  question: string;
  value: T | null;
  options: readonly { id: T; label: string }[];
  onSelect: (id: T) => void;
}

function NumberedQuestion<T extends string>({
  number,
  question,
  value,
  options,
  onSelect,
}: NumberedQuestionProps<T>) {
  const numeral = String(number).padStart(2, "0");
  return (
    <fieldset>
      <legend className="flex items-baseline gap-x-3">
        <span className="font-mono text-eyebrow uppercase tracking-[0.15em] text-primary">
          {numeral}
        </span>
        <span className="text-body-lg text-ink">{question}</span>
      </legend>
      {/*
        Pill spacing: gap-3 sm:gap-4 between options, generous internal
        padding (px-6 py-3) so each pill reads as a deliberate target
        rather than a cramped form-control row. Selected state lifts to
        surface-2 + primary border for a stronger pressed signal.
      */}
      <div className="mt-6 flex flex-wrap gap-3 sm:gap-4">
        {options.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              aria-pressed={selected}
              className={`rounded-full border px-6 py-3 text-body transition-colors duration-150 ${
                selected
                  ? "border-primary bg-surface-2 text-ink"
                  : "border-hairline bg-canvas text-ink-subtle hover:border-hairline-strong hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// DiagnosisCard — uses the home page ProofItem treatment: surface-1 +
// hairline border + lavender stroke at top-left.
// ---------------------------------------------------------------------------

interface DiagnosisCardProps {
  text: string;
  disclaimer: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
}

function DiagnosisCard({
  text,
  disclaimer,
  primaryCta,
  secondaryCta,
}: DiagnosisCardProps) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="group relative mt-12 flex flex-col gap-5 rounded-lg border border-hairline bg-canvas p-8"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-8 top-0 h-px w-12 bg-primary"
      />
      <span className="text-eyebrow uppercase text-primary">Diagnosis</span>
      <p className="text-body-lg text-ink">{text}</p>
      <p className="text-caption leading-[1.6] text-ink-tertiary">
        {disclaimer}
      </p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:gap-4">
        <Link
          href={primaryCta.href}
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-button text-white transition-colors duration-150 hover:bg-primary-hover"
        >
          {primaryCta.label}
        </Link>
        <Link
          href={secondaryCta.href}
          className="inline-flex items-center justify-center rounded-md border border-hairline-strong px-6 py-3 text-button text-ink transition-colors duration-150 hover:border-primary"
        >
          {secondaryCta.label}
        </Link>
      </div>
    </motion.article>
  );
}
