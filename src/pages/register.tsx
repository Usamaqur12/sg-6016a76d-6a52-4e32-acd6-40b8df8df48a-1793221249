import { useEffect } from "react";
import { useRouter } from "next/router";

export default function RegisterRedirect() {
  const router = useRouter();
  useEffect(() => { void router.replace("/auth/register"); }, [router]);
  return null;
}
