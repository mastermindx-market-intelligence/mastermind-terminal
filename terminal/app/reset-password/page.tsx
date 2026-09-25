import { cookies } from "next/headers";
import ResetPasswordClient from "./ResetPasswordClient";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/passwordRecovery";

export default async function ResetPasswordPage() {
  const jar = await cookies();
  const recoveryAllowed = jar.get(PASSWORD_RECOVERY_COOKIE)?.value === "1";
  return <ResetPasswordClient recoveryAllowed={recoveryAllowed} />;
}
