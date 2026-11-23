import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/supabase/access";

export default async function Workspaces({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { db } = await requireSession();
  const query = await searchParams;
  const { data, error } = await db.from("organizations").select("id,name").order("name");
  return <main className="oniro-access">
    <section className="oniro-panel">
      <h1>Your workspaces</h1>
      {error && <p role="alert">Workspaces are temporarily unavailable. Reload to try again.</p>}
      {query.notice === "create" && <p role="alert">Unable to create that workspace. Check the name or try again.</p>}
      {data?.length ? <ul>{data.map((org) => <li key={org.id}><Link href={"/workspace/" + org.id}>{org.name}</Link></li>)}</ul> : null}
      <form action="/api/organizations" method="post">
        <label>Organization name<input name="name" maxLength={100} required /></label>
        <Button type="submit">Create workspace</Button>
      </form>
      <nav><Link href="/demo">Open demo</Link><form action="/auth/logout" method="post"><button type="submit">Sign out</button></form></nav>
    </section>
  </main>;
}
