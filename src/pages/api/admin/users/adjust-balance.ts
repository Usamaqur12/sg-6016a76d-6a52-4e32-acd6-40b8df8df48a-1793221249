import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const requestSchema = z.object({
  userId: z.string().uuid(),
  amount: z.coerce.number().finite().min(0.01).max(100000),
  operation: z.enum(["add", "subtract"]),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().uuid(),
});

type SupabaseFailure = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function getFailure(error: unknown): SupabaseFailure {
  if (error instanceof Error) return { message: error.message };
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      code: typeof value.code === "string" ? value.code : undefined,
      message: typeof value.message === "string" ? value.message : undefined,
      details: typeof value.details === "string" ? value.details : undefined,
      hint: typeof value.hint === "string" ? value.hint : undefined,
    };
  }
  return {};
}

function isMissingRpc(error: unknown, functionName: string) {
  const failure = getFailure(error);
  const text = [failure.message, failure.details, failure.hint].filter(Boolean).join(" ").toLowerCase();
  return failure.code === "PGRST202"
    || (text.includes(functionName.toLowerCase()) && (
      text.includes("schema cache")
      || text.includes("could not find")
      || text.includes("does not exist")
    ));
}

function publicErrorMessage(error: unknown) {
  const failure = getFailure(error);
  const text = failure.message || failure.details || "Balance adjustment failed";

  if (isMissingRpc(error, "admin_adjust_user_balance")) {
    return "Balance adjustment database migration is not installed";
  }
  if (/service authorization required/i.test(text)) {
    return "Server Supabase service key is missing or invalid";
  }
  if (/customer account not found/i.test(text)) {
    return "Customer account was not found";
  }
  if (/balance cannot be reduced below zero|insufficient/i.test(text)) {
    return "Balance cannot be reduced below zero";
  }

  return text;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdminApi(req, res);
  if (!auth) return;

  if (!["super_admin", "admin", "finance"].includes(auth.adminRole)) {
    return res.status(403).json({ error: "Finance authorization required" });
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.find((issue) => issue.path[0] === "reason");
    const amountIssue = parsed.error.issues.find((issue) => issue.path[0] === "amount");
    return res.status(400).json({
      error: reasonIssue
        ? "Enter an adjustment reason of at least 5 characters"
        : amountIssue
          ? "Enter an amount from 0.01 to 100000.00"
          : "Enter valid balance adjustment details",
    });
  }

  const roundedAmount = Math.round(parsed.data.amount * 100) / 100;
  const signedAmount = parsed.data.operation === "subtract" ? -roundedAmount : roundedAmount;
  const rpcArguments = {
    p_user_id: parsed.data.userId,
    p_amount: signedAmount,
    p_reason: parsed.data.reason,
    p_admin_id: auth.userId,
    p_idempotency_key: parsed.data.idempotencyKey,
  };

  try {
    const adjustment = await supabaseAdmin.rpc("admin_adjust_user_balance", rpcArguments);

    if (!adjustment.error) {
      return res.status(200).json({ success: true, result: adjustment.data });
    }

    // Older production databases may have the original credit-only RPC while
    // the signed adjustment migration is still being deployed. Keep additions
    // working through that already-audited, atomic function.
    if (
      parsed.data.operation === "add"
      && isMissingRpc(adjustment.error, "admin_adjust_user_balance")
    ) {
      const credit = await supabaseAdmin.rpc("admin_credit_user_balance", {
        ...rpcArguments,
        p_amount: roundedAmount,
      });

      if (!credit.error) {
        return res.status(200).json({
          success: true,
          result: credit.data,
          compatibilityMode: true,
        });
      }

      throw credit.error;
    }

    throw adjustment.error;
  } catch (error) {
    const failure = getFailure(error);
    console.error("Balance adjustment failed", {
      code: failure.code,
      message: failure.message,
      details: failure.details,
      hint: failure.hint,
    });
    return res.status(500).json({
      error: publicErrorMessage(error),
      code: failure.code,
    });
  }
}
