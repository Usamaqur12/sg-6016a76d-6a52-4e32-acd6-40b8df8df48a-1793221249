import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { hasAccess } from "@/lib/adminRoles";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";
import { encryptProviderSecret } from "@/lib/server/providerSecrets";
import { providerTypes } from "@/lib/server/sportsProviders";
import { z } from "zod";

const THE_SPORTS_DB_FREE_URL = "https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=Arsenal";

function isTheSportsDbFreeCredential(value: string | undefined) {
  const candidate = value?.trim() || "";
  return candidate === "123" ||
    /thesportsdb\.com\/api\/v1\/json\/123(?:\/|$)/i.test(candidate);
}

const providerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  providerType: z.enum(providerTypes),
  apiKey: z.string().trim().min(3).max(500).optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
  isEnabled: z.boolean().default(false),
  priority: z.number().int().min(1).max(1000).default(100),
  syncIntervalSeconds: z.number().int().min(5).max(3600).default(60),
  copyApiKeyFromProviderId: z.string().uuid().optional(),
});

function sanitizeProvider(provider: Record<string, unknown>) {
  const { encrypted_api_key, ...safe } = provider;
  return { ...safe, has_api_key: Boolean(encrypted_api_key) };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown provider error";
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
    } catch (error: unknown) {
      console.error("Failed to fetch providers:", error);
      return res.status(500).json({
        error: "Failed to fetch providers",
        details: errorMessage(error),
      });
    }
  }

  if (req.method === "POST") {
    try {
      const parsed = providerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid provider configuration",
          details: parsed.error.flatten(),
        });
      }

      const value = parsed.data;
      const normalizedFromFreeV1 =
        value.providerType === "thesportsdb_live" &&
        isTheSportsDbFreeCredential(value.apiKey);
      const effectiveProviderType = normalizedFromFreeV1
        ? "thesportsdb_demo"
        : value.providerType;
      const isPublicProvider = ["openligadb", "thesportsdb_demo"].includes(effectiveProviderType);

      let encryptedApiKey: string | null = null;
      if (!isPublicProvider && value.apiKey) {
        encryptedApiKey = encryptProviderSecret(value.apiKey);
      } else if (!isPublicProvider && value.copyApiKeyFromProviderId) {
        const { data: sourceProvider, error: sourceError } = await supabaseAdmin
          .from("sports_feed_providers")
          .select("provider_type, encrypted_api_key")
          .eq("id", value.copyApiKeyFromProviderId)
          .single();

        if (sourceError || !sourceProvider?.encrypted_api_key) {
          return res.status(400).json({ error: "The selected provider has no reusable API key" });
        }
        if (sourceProvider.provider_type !== effectiveProviderType) {
          return res.status(400).json({ error: "API keys can only be reused by the same provider type" });
        }
        encryptedApiKey = sourceProvider.encrypted_api_key;
      }

      if (!isPublicProvider && !encryptedApiKey) {
        return res.status(400).json({ error: "This premium provider requires an API key" });
      }

      const settings = effectiveProviderType === "thesportsdb_demo"
        ? {
            ...value.settings,
            leagueId: String(value.settings.leagueId || "4328"),
            sourceEndpoint: THE_SPORTS_DB_FREE_URL,
          }
        : value.settings;

      const { data, error } = await supabaseAdmin.from("sports_feed_providers").insert({
        name: normalizedFromFreeV1 ? "TheSportsDB Free v1" : value.name,
        provider_type: effectiveProviderType,
        encrypted_api_key: encryptedApiKey,
        settings,
        is_enabled: value.isEnabled,
        is_demo: isPublicProvider,
        priority: value.priority,
        sync_interval_seconds: effectiveProviderType === "thesportsdb_demo"
          ? Math.max(value.syncIntervalSeconds, 60)
          : value.syncIntervalSeconds,
        status: value.isEnabled ? "not_tested" : "disabled",
        created_by: adminAuth.userId,
      }).select().single();

      if (error) throw error;

      return res.status(201).json({
        provider: sanitizeProvider(data),
        normalizedFromFreeV1,
        message: value.isEnabled
          ? "Sports provider saved. Use Sync now to import events."
          : "Sports provider saved. Enable it, then use Sync now to import events.",
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      console.error("Failed to create provider:", error);
      return res.status(500).json({
        error: message === "Unknown provider error" ? "Failed to create provider" : message,
      });
    }
  }

  if (req.method === "PUT") {
    try {
      const { id, isEnabled, apiKey, settings } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Provider ID is required" });
      }

      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (isEnabled !== undefined) {
        updateData.is_enabled = Boolean(isEnabled);
        updateData.status = isEnabled ? "not_tested" : "disabled";
      }
      if (apiKey) updateData.encrypted_api_key = encryptProviderSecret(String(apiKey));
      if (settings !== undefined) {
        const parsedSettings = z.record(z.string(), z.unknown()).safeParse(settings);
        if (!parsedSettings.success) return res.status(400).json({ error: "Invalid provider settings" });
        updateData.settings = parsedSettings.data;
        updateData.status = "not_tested";
      }

      const { data, error } = await supabaseAdmin
        .from("sports_feed_providers")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({
        provider: sanitizeProvider(data),
        message: Boolean(isEnabled)
          ? "Provider enabled. Use Sync now to import events."
          : "Provider updated.",
      });
    } catch (error: unknown) {
      console.error("Failed to update provider:", error);
      return res.status(500).json({
        error: "Failed to update provider",
        details: errorMessage(error),
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
    } catch (error: unknown) {
      console.error("Failed to delete provider:", error);
      return res.status(500).json({
        error: "Failed to delete provider",
        details: errorMessage(error),
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
