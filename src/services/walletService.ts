import { supabase } from "@/integrations/supabase/client";

export interface WalletBalances {
    currency: string;
    cash: number;
    bonus: number;
    locked: number;
    available: number;
}

const LEGACY_WELCOME_DESCRIPTION = "Welcome bonus - Demo credits";

function isLegacyWelcomeTransaction(transaction: any): boolean {
    return (
        transaction?.description === LEGACY_WELCOME_DESCRIPTION &&
        Number(transaction?.amount) === 10000
    );
}

export async function getMyWalletBalances(): Promise<{
    balances: WalletBalances | null;
    error?: string;
}> {
    try {
        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError) throw userError;

        if (!user) {
            return {
                balances: null,
                error: "Authentication required",
            };
        }

        const { data: accountRows, error: accountError } = await (supabase as any)
            .from("ledger_accounts")
            .select("account_code,balance,currency")
            .eq("user_id", user.id)
            .eq("currency", "USD");

        if (accountError || !accountRows || accountRows.length === 0) {
            const { data, error } = await supabase.rpc(
                "get_my_wallet_balances"
            );

            if (error) throw error;

            if (
                !data ||
                typeof data !== "object" ||
                Array.isArray(data)
            ) {
                return { balances: null };
            }

            const value = data as Record<string, unknown>;

            const cash = Math.max(
                0,
                Number(value.cash || 0)
            );

            const bonus = Math.max(
                0,
                Number(value.bonus || 0)
            );

            const locked = Math.max(
                0,
                Number(value.locked || 0)
            );

            return {
                balances: {
                    currency:
                        typeof value.currency === "string"
                            ? value.currency
                            : "USD",
                    cash,
                    bonus,
                    locked,
                    available: cash + bonus,
                },
            };
        }

        const rows = (accountRows || []) as Array<{
            account_code: string;
            balance: number | string;
            currency: string;
        }>;

        const balanceFor = (code: string) =>
            Math.max(
                0,
                Number(
                    rows.find(
                        (row) => row.account_code === code
                    )?.balance || 0
                )
            );

        const cash = balanceFor("cash");
        const bonus = balanceFor("bonus");
        const locked = balanceFor("locked");

        return {
            balances: {
                currency: rows[0]?.currency || "USD",
                cash,
                bonus,
                locked,
                available: cash + bonus,
            },
        };
    } catch (error) {
        console.error(
            "Get wallet balances error:",
            error
        );

        return {
            balances: null,
            error:
                error instanceof Error
                    ? error.message
                    : "Unable to load wallet balances",
        };
    }
}

export async function getUserTransactions(
    userId: string,
    limit = 50
) {
    try {
        const { data, error } = await supabase
            .from("wallet_transactions")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", {
                ascending: false,
            })
            .limit(limit);

        if (error) throw error;

        return {
            success: true,
            transactions: (data || []).filter(
                (transaction: any) =>
                    !isLegacyWelcomeTransaction(transaction)
            ),
        };
    } catch (error) {
        console.error(
            "Get user transactions error:",
            error
        );

        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Unable to load transactions",
        };
    }
}

export async function getAllTransactions(filters?: {
    type?: string;
    status?: string;
    userId?: string;
    fromDate?: string;
    toDate?: string;
}) {
    try {
        let query = supabase
            .from("wallet_transactions")
            .select(
                `
        *,
        profiles!wallet_transactions_user_id_fkey (
          email,
          full_name
        )
      `
            )
            .order("created_at", {
                ascending: false,
            });

        if (filters?.type) {
            query = query.eq(
                "type",
                filters.type
            );
        }

        if (filters?.status) {
            query = query.eq(
                "status",
                filters.status
            );
        }

        if (filters?.userId) {
            query = query.eq(
                "user_id",
                filters.userId
            );
        }

        if (filters?.fromDate) {
            query = query.gte(
                "created_at",
                filters.fromDate
            );
        }

        if (filters?.toDate) {
            query = query.lte(
                "created_at",
                filters.toDate
            );
        }

        const { data, error } =
            await query.limit(100);

        if (error) throw error;

        return {
            success: true,
            transactions: (data || []).filter(
                (transaction: any) =>
                    !isLegacyWelcomeTransaction(transaction)
            ),
        };
    } catch (error) {
        console.error(
            "Get all transactions error:",
            error
        );

        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Unable to load transactions",
        };
    }
}