import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAuthClientConfig } from "../auth-config";
import { LoginForm } from "./login-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/account");

  const config = await getAuthClientConfig();
  return (
    <LoginForm
      turnstileSiteKey={config.turnstileSiteKey}
      googleOauthEnabled={config.googleOauthEnabled}
    />
  );
}
