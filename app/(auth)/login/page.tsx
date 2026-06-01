import { getAuthClientConfig } from "../auth-config";
import { LoginForm } from "./login-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const config = await getAuthClientConfig();
  return (
    <LoginForm
      turnstileSiteKey={config.turnstileSiteKey}
      googleOauthEnabled={config.googleOauthEnabled}
    />
  );
}
