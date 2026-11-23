import Link from "next/link";
import { Button } from "@/components/ui/button";
import { verifyInviteToken } from "@/lib/supabase/auth-actions";
import { publicSupabaseConfig } from "@/lib/supabase/config";

const messages: Record<string, string> = {
  configuration: "Live workspaces require Supabase configuration. You can still open the demo.",
  invalid: "Check the email and password fields.",
  login: "Unable to sign in. Check your credentials and confirm your email if required.",
  signup: "Unable to create the account. Try again or sign in if you already have an account.",
  "check-email": "Check your email for a confirmation link. Open it in the browser where you signed up.",
  confirm: "That confirmation link could not be verified. Check the link or sign in.",
  logout: "Sign-out could not be confirmed. Please try again from your workspace.",
};

export function AuthForm({ mode, query }: { mode: "login" | "signup"; query: { notice?: string; invite?: string } }) {
  const ready = Boolean(publicSupabaseConfig());
  const invite = verifyInviteToken(query.invite);
  const heading = mode === "login" ? "Sign in to Oniro Dev" : "Create your Oniro Dev account";
  const other = mode === "login" ? "/signup" : "/login";
  const notice = ready ? query.notice ?? "" : "configuration";
  const message = Object.hasOwn(messages, notice) ? messages[notice] : undefined;
  return <main className="oniro-access">
    <section className="oniro-panel">
      <h1>{heading}</h1>
      {message && <p role="status">{message}</p>}
      {ready && <form action={"/auth/" + mode} method="post">
        {invite && <input type="hidden" name="invite" value={invite} />}
        <label>Email<input autoComplete="email" name="email" type="email" maxLength={254} required /></label>
        <label>Password<input autoComplete={mode === "login" ? "current-password" : "new-password"}
          name="password" type="password" minLength={mode === "signup" ? 8 : 1} maxLength={128} required /></label>
        <Button type="submit">{mode === "login" ? "Sign in" : "Create account"}</Button>
      </form>}
      <nav><Link href={invite ? { pathname: other, query: { invite } } : other}>{mode === "login" ? "Create an account" : "Sign in"}</Link><Link href="/demo">Open demo</Link></nav>
    </section>
  </main>;
}
