// Barrel export for the About page section component family.
// Mirrors the home/index.ts pattern — keeps the surface area predictable
// and discourages deep imports.
//
// Intended reuse: parts of this family (PersonCard, PhilosophyBlock) are
// expected to flow into the Consulting page and the Modelling Room landing
// when those pages are built.

export {
  PersonCard,
  type PersonCardProps,
  type SocialLink,
  type SocialPlatform,
} from "./person-card";
export {
  PhilosophyBlock,
  type PhilosophyBlockProps,
} from "./philosophy-block";
export {
  WayOfWorkingSteps,
  type WayOfWorkingStep,
  type WayOfWorkingStepsProps,
} from "./way-of-working-steps";
export {
  SelectedWorkCard,
  type SelectedWorkCardProps,
} from "./selected-work-card";
