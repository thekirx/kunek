import { AuthForm } from "@/components/auth-form";
export default async function Signup({ searchParams }: { searchParams: Promise<{ notice?: string; invite?: string }> }) {
  return <AuthForm mode="signup" query={await searchParams} />;
}
