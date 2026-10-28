import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { hasAccess } from "@/lib/adminRoles";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { encryptProviderSecret } from "@/lib/server/providerSecrets";
import { providerTypes } from "@/lib/server/sportsProviders";
import { z } from "zod";

const providerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  providerType: z.enum(providerTypes),
  apiKey: z.string().trim().min(3).max(500).optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
  isEnabled: z.boolean().default(false),
  priority: z.number().int().min(1).max(1000).default(100),
  syncIntervalSeconds: z.number().int().min(5).max(3600).default(60),
});

function sanitizeProvider(provider: Record<string, unknown>) {
  const { encrypted_api_key, ...safe } = provider;
  return { ...safe, has_api_key: Boolean(encrypted_api_key) };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const adminAuth = await requireAdminApi(req, res);
  if (!adminAuth) return;

  if (!hasAccess(adminAuth.adminRole, "sports_management")) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method === "GET") {
    try {
      const { data, error } = await supabaseAdmin
        .from("sports_feed_providers")
        .select("*")
        .order("priority", { ascending: true });

      if (error) throw error;

      return res.status(200).json({ providers: (data || []).map(sanitizeProvider) });
    } catch (error: any) {
      console.error("Failed to fetch providers:", error);
      return res.status(500).json({
        error: "Failed to fetch providers",
        details: error.message,
      });
    }
  }

  if (req.method === "POST") {
    try {
      const parsed = providerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid provider configuration", details: parsed.error.flatten() });
      const value = parsed.data;
      if (!["openligadb", "thesportsdb_demo"].includes(value.providerType) && !value.apiKey) {
        return res.status(400).json({ error: "This provider requires an API key" });
      }

      const { data, error } = await supabaseAdmin.from("sports_feed_providers").insert({
        name: value.name,
        provider_type: value.providerType,
        encrypted_api_key: value.apiKey ? encryptProviderSecret(value.apiKey) : null,
        settings: value.settings,
        is_enabled: value.isEnabled,
        is_demo: ["openligadb", "thesportsdb_demo"].includes(value.providerType),
        priority: value.priority,
        sync_interval_seconds: value.syncIntervalSeconds,
        status: value.isEnabled ? "not_tested" : "disabled",
        created_by: adminAuth.userId,
      }).select().single();

      if (error) throw error;

      return res.status(201).json({ provider: sanitizeProvider(data) });
    } catch (error: any) {
      console.error("Failed to create provider:", error);
      return res.status(500).json({
        error: "Failed to create provider",
        details: error.message,
      });
    }
  }

  if (req.method === "PUT") {
    try {
      const { id, isEnabled, apiKey } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Provider ID is required" });
      }

      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (isEnabled !== undefined) {
        updateData.is_enabled = Boolean(isEnabled);
        updateData.status = isEnabled ? "not_tested" : "disabled";
      }
      if (apiKey) updateData.encrypted_api_key = encryptProviderSecret(String(apiKey));

      const { data, error } = await supabaseAdmin
        .from("sports_feed_providers")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ provider: sanitizeProvider(data) });
    } catch (error: any) {
      console.error("Failed to update provider:", error);
      return res.status(500).json({
        error: "Failed to update provider",
        details: error.message,
      });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = (Array.isArray(req.query.id) ? req.query.id[0] : req.query.id) || req.body?.id;

      if (!id) {
        return res.status(400).json({ error: "Provider ID is required" });
      }

      const { error } = await supabaseAdmin
        .from("sports_feed_providers")
        .delete()
        .eq("id", id);

      if (error) throw error;

      return res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Failed to delete provider:", error);
      return res.status(500).json({
        error: "Failed to delete provider",
        details: error.message,
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
