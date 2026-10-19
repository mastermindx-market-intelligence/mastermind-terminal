import { createClient } from "@/lib/supabase/client";

/**
 * The single browser-side password mutation boundary.
 *
 * Account settings and recovery both update the same Supabase identity. Keeping
 * the write here prevents two subtly different password planes from evolving.
 */
export async function updateAuthPassword(password: string, currentPassword?: string) {
  const attributes = currentPassword
    ? { password, current_password: currentPassword }
    : { password };
  return createClient().auth.updateUser(attributes);
}
