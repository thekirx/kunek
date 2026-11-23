import { handleCredentials } from "@/lib/supabase/auth-actions";
export function POST(request: Request) { return handleCredentials(request, "signup"); }
