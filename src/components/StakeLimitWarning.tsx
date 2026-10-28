import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface StakeLimitWarningProps {
  userId: string;
  currentStake: number;
  onLimitExceeded?: (exceeded: boolean) => void;
}

interface ResponsibleLimit {
  limit_type: string;
  limit_value: number;
  current_usage: number;
  period_end: string;
}

export function StakeLimitWarning({ userId, currentStake, onLimitExceeded }: StakeLimitWarningProps) {
  const [limits, setLimits] = useState<ResponsibleLimit[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLimits();
  }, [userId]);

  useEffect(() => {
    checkLimits();
  }, [currentStake, limits]);

  async function loadLimits() {
    try {
      const { data } = await (supabase as any)
        .from("responsible_gaming_limits")
        .select("limit_type, limit_value, current_usage, period_end")
        .eq("user_id", userId)
        .eq("is_active", true)
        .gte("period_end", new Date().toISOString());

      setLimits(data || []);
    } catch (error) {
      console.error("Failed to load limits:", error);
    } finally {
      setLoading(false);
    }
  }

  function checkLimits() {
    const newWarnings: string[] = [];
    let exceeded = false;

    for (const limit of limits) {
      const projectedUsage = (limit.current_usage || 0) + currentStake;
      const remaining = limit.limit_value - (limit.current_usage || 0);
      const percentUsed = (projectedUsage / limit.limit_value) * 100;

      if (projectedUsage > limit.limit_value) {
        exceeded = true;
        newWarnings.push(
          `This bet exceeds your ${formatLimitType(limit.limit_type)} limit by $${(projectedUsage - limit.limit_value).toFixed(2)}`
        );
      } else if (percentUsed >= 90) {
        newWarnings.push(
          `This bet will use ${percentUsed.toFixed(0)}% of your ${formatLimitType(limit.limit_type)} limit ($${remaining.toFixed(2)} remaining)`
        );
      } else if (percentUsed >= 75) {
        newWarnings.push(
          `You have $${remaining.toFixed(2)} remaining in your ${formatLimitType(limit.limit_type)} limit`
        );
      }
    }

    setWarnings(newWarnings);
    onLimitExceeded?.(exceeded);
  }

  function formatLimitType(type: string): string {
    return type.replace("_stake", "").replace("_", " ");
  }

  if (loading || warnings.length === 0) {
    return null;
  }

  const hasExceeded = limits.some(
    (limit) => (limit.current_usage || 0) + currentStake > limit.limit_value
  );

  return (
    <Alert variant={hasExceeded ? "destructive" : "default"} className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-1">
          {warnings.map((warning, index) => (
            <div key={index} className="text-sm">
              {warning}
            </div>
          ))}
          {hasExceeded && (
            <div className="text-sm font-semibold mt-2">
              Cannot place bet - would exceed your responsible gaming limits
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}