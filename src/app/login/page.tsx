import { AuthForm } from "@/components/auth-form";
export default async function Login({ searchParams }: { searchParams: Promise<{ notice?: string; invite?: string }> }) {
  return <AuthForm mode="login" query={await searchParams} />;
}
