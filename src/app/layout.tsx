import type { Metadata } from "next";
import { brand } from "@/lib/inbox/demo";
import "./globals.css";

export const metadata: Metadata = {
  title: `Inbox · ${brand.name}`,
  description: "A shared workspace for customer conversations",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
