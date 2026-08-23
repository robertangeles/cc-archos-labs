---
title: Watermark Remover — CTA removed entirely
category: decision
created: 2026-08-23
updated: 2026-08-23
related: [[watermark-remover]]
---

The "Handling this for a client deliverable? Talk to Archos Labs about AI content governance" CTA was removed from [[watermark-remover]] — copy, `/consulting` link, `trackWatermarkCtaClicked` analytics event, and its test, all deleted.

## Why

The tool's original design (`docs/designs/watermark-remover.md`, Premise 6) named this CTA as the sole lead-gen mechanism — deliberately in place of a registration gate, since gating would contradict the tool's "we never see your content" trust pitch. Live review of the shipped page called the CTA "useless." Asked to pin down what specifically was wrong (weak copy / wrong to have at all / wrong placement), the answer was **wrong to have it at all**: a privacy-first tool selling something at the bottom of the page undermines the trust-first positioning the whole tool depends on.

## Consequence

This tool now has **no conversion path back to the consulting track**. The Distribution Plan and Premise 6 in the design doc describe a lead-gen mechanism that no longer exists in the shipped product. Not fixed as part of this change — flagged as an open question in [[watermark-remover]] for whoever picks it up next: is a non-copy-based conversion mechanism worth exploring, or does this tool stay a pure trust-building public utility with no funnel?
