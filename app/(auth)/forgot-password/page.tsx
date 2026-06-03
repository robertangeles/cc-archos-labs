import { getAuthClientConfig } from "../auth-config";
import { ForgotPasswordForm } from "./forgot-password-form";

export const runtime = "nodejs";

export default async function ForgotPasswordPage() {
  const config = await getAuthClientConfig();
  return <ForgotPasswordForm turnstileSiteKey={config.turnstileSiteKey} />;
}
