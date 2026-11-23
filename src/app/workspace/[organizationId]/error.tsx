"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="oniro-access"><section className="oniro-panel">
    <h1>Unable to load this workspace</h1>
    <p role="alert">Check your connection and try again.</p>
    <Button onClick={reset}>Try again</Button>
    <Link href="/workspace">All workspaces</Link>
  </section></main>;
}
