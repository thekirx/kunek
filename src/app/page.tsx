import { redirect } from "next/navigation";
import { publicSupabaseConfig } from "@/lib/supabase/config";

export default function Home() {
  redirect(publicSupabaseConfig() ? "/workspace" : "/demo");
}
