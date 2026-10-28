import { useEffect } from "react";
import { useRouter } from "next/router";

export default function AffiliatesPage() {
  const router = useRouter();
  useEffect(() => { void router.replace("/broker"); }, [router]);
  return null;
}
