import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { hasAccess } from "@/lib/adminRoles";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const createProviderSchema = z.object({
  resource: z.literal("provider"),
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/),
  name: z.string().trim().min(2).max(160),
});
const createGameSchema = z.object({
  resource: z.literal("game"), provider_id: z.string().uuid(),
  external_game_id: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(200),
  category: z.enum(["slots", "live", "table", "jackpot", "instant", "other"]),
});

async function writeAudit(adminId: string, action: string, entityType: string, entityId: string, changes: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({ admin_id: adminId, action, entity_type: entityType, entity_id: entityId, changes });
  if (error) throw error;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!hasAccess(auth.adminRole, "casino")) return res.status(403).json({ error: "Casino authorization required" });

  try {
    if (req.method === "GET") {
      const [providers, games] = await Promise.all([
        supabaseAdmin.from("casino_providers").select("*").order("name"),
        supabaseAdmin.from("casino_games").select("*").order("name"),
      ]);
      if (providers.error) throw providers.error;
      if (games.error) throw games.error;
      return res.status(200).json({ providers: providers.data || [], games: games.data || [] });
    }

    if (req.method === "POST") {
      const provider = createProviderSchema.safeParse(req.body);
      if (provider.success) {
        const { resource: _resource, ...values } = provider.data;
        const { data, error } = await supabaseAdmin.from("casino_providers").insert({ ...values, is_enabled: false, is_demo: false, status: "not_tested" }).select("id").single();
        if (error) throw error;
        await writeAudit(auth.userId, "casino_provider_created", "casino_provider", data.id, values);
        return res.status(201).json({ success: true, id: data.id });
      }
      const game = createGameSchema.safeParse(req.body);
      if (!game.success) return res.status(400).json({ error: "Valid provider or game fields are required" });
      const { resource: _resource, ...values } = game.data;
      const { data, error } = await supabaseAdmin.from("casino_games").insert({ ...values, is_active: false }).select("id").single();
      if (error) throw error;
      await writeAudit(auth.userId, "casino_game_created", "casino_game", data.id, values);
      return res.status(201).json({ success: true, id: data.id });
    }

    if (req.method === "PATCH") {
      const parsed = z.object({ resource: z.enum(["provider", "game"]), id: z.string().uuid(), enabled: z.boolean() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid catalogue update is required" });
      if (parsed.data.resource === "provider" && parsed.data.enabled) {
        const { data: provider, error } = await supabaseAdmin.from("casino_providers").select("status,is_demo").eq("id", parsed.data.id).maybeSingle();
        if (error) throw error;
        if (!provider) return res.status(404).json({ error: "Provider not found" });
        if (provider.is_demo || provider.status !== "healthy") return res.status(409).json({ error: "Only a non-demo provider with a successful health check can be enabled" });
      }
      if (parsed.data.resource === "game" && parsed.data.enabled) {
        const { data: game, error } = await supabaseAdmin.from("casino_games").select("provider_id").eq("id", parsed.data.id).maybeSingle();
        if (error) throw error;
        if (!game) return res.status(404).json({ error: "Game not found" });
        const { data: provider, error: providerError } = await supabaseAdmin.from("casino_providers").select("is_enabled,is_demo,status").eq("id", game.provider_id).maybeSingle();
        if (providerError) throw providerError;
        if (!provider?.is_enabled || provider.is_demo || provider.status !== "healthy") return res.status(409).json({ error: "Enable and verify the licensed provider before activating its games" });
      }
      const table = parsed.data.resource === "provider" ? "casino_providers" : "casino_games";
      const field = parsed.data.resource === "provider" ? "is_enabled" : "is_active";
      const { error } = await supabaseAdmin.from(table).update({ [field]: parsed.data.enabled, updated_at: new Date().toISOString() }).eq("id", parsed.data.id);
      if (error) throw error;
      await writeAudit(auth.userId, `casino_${parsed.data.resource}_${parsed.data.enabled ? "enabled" : "disabled"}`, `casino_${parsed.data.resource}`, parsed.data.id, { enabled: parsed.data.enabled });
      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const id = z.string().uuid().safeParse(Array.isArray(req.query.id) ? req.query.id[0] : req.query.id);
      if (!id.success || req.query.resource !== "game") return res.status(400).json({ error: "Valid game ID is required" });
      const { error } = await supabaseAdmin.from("casino_games").delete().eq("id", id.data);
      if (error) throw error;
      await writeAudit(auth.userId, "casino_game_deleted", "casino_game", id.data, {});
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Casino catalogue operation failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Casino catalogue operation failed" });
  }
}
