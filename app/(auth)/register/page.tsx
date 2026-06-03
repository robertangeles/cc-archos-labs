import { getAuthClientConfig } from "../auth-config";
import { RegisterForm } from "./register-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const config = await getAuthClientConfig();
  return (
    <RegisterForm
      turnstileSiteKey={config.turnstileSiteKey}
      googleOauthEnabled={config.googleOauthEnabled}
    />
  );
}
