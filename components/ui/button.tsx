// Primary + ghost CTA button. Matches the existing home page `ctaButtonClass`
// style for `primary`. `ghost` is a 1px-border outline variant used for
// secondary actions (retry, add-to-calendar). Both use `rounded-md`
// per plan §17.4 (no `rounded-full` pills anywhere).

import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

const baseClass =
  "inline-flex items-center justify-center rounded-md px-7 py-3 text-button transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50 disabled:cursor-not-allowed";

const variantClass: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  ghost: "border border-hairline text-ink hover:border-primary",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", className = "", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={`${baseClass} ${variantClass[variant]} ${className}`}
        {...props}
      />
    );
  },
);
