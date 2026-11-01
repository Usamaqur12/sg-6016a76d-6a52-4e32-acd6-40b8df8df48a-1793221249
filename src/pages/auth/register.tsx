import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md bg-surface border-border text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <LockKeyhole className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Registration is invite-only</CardTitle>
          <CardDescription>
            Customer accounts are created by an administrator. Public self-registration is disabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            If an administrator created your account, use the email and temporary password they provided.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href="/auth/login">Go to login</Link>
          </Button>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Back to home</Link>
        </CardFooter>
      </Card>
    </div>
  );
}
