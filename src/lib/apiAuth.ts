import { supabase } from "@/lib/supabase";

/** Returns request headers for endpoints protected by the current Supabase JWT. */
export async function authenticatedHeaders(contentType?: string): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}