import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "./types";

export interface Profile {
  user_id: string;
  role: Actor;
  display_name: string;
}

export const HOME: Record<Actor, string> = { lenovo: "/lenovo", dhl: "/dhl", admin: "/admin" };

export async function fetchProfile(client: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data } = await client
    .from("profiles")
    .select("user_id, role, display_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}
