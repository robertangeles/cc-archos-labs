import "server-only";
import { cache } from "react";
import { getCurrentUser } from "./auth/current-user";

// "Who is the signed-in visitor?" helper for the site-wide layout.
// Used by app/layout.tsx to decide whether the header shows "Sign in"
// or the user's name + sign-out.

export interface SignedInLead {
  leadId: string;
  firstName: string;
}

export const getSignedInLead = cache(
  async (): Promise<SignedInLead | null> => {
    const auth = await getCurrentUser();
    if (!auth) return null;

    const displayName = auth.user.displayName ?? auth.user.email;
    const firstName = displayName.split(" ")[0] ?? displayName;

    return { leadId: auth.user.id, firstName };
  },
);
