import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { hasAccess } from "@/lib/adminRoles";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

const resourceSchema = z.enum(["sports", "leagues", "events", "markets", "odds"]);
const marketTypeSchema = z.enum(["match_result", "over_under", "handicap", "both_teams_score", "correct_score", "double_chance", "draw_no_bet", "first_half", "total_goals"]);
const uuid = z.string().uuid();

const createSchemas = {
  sports: z.object({ name: z.string().trim().min(1).max(120), icon: z.string().trim().max(20).default("🏆") }),
  leagues: z.object({ sport_id: uuid, name: z.string().trim().min(1).max(160), country: z.string().trim().max(120).nullable() }),
  events: z.object({ sport_id: uuid, league_id: uuid, home_team: z.string().trim().min(1).max(160), away_team: z.string().trim().min(1).max(160), start_time: z.string().datetime() }),
  markets: z.object({ event_id: uuid, name: z.string().trim().min(1).max(160), type: marketTypeSchema, line: z.number().finite().nullable() }),
  odds: z.object({ market_id: uuid, selection: z.string().trim().min(1).max(160), value: z.number().finite().min(1.01).max(10000) }),
};

const updateSchemas = {
  sports: z.object({ name: z.string().trim().min(1).max(120).optional(), is_active: z.boolean().optional() }),
  leagues: z.object({ name: z.string().trim().min(1).max(160).optional(), is_active: z.boolean().optional() }),
  events: z.object({ home_team: z.string().trim().min(1).max(160).optional(), away_team: z.string().trim().min(1).max(160).optional() }),
  markets: z.object({ name: z.string().trim().min(1).max(160).optional(), status: z.enum(["active", "suspended"]).optional() }),
  odds: z.object({ selection: z.string().trim().min(1).max(160).optional(), value: z.number().finite().min(1.01).max(10000).optional(), is_active: z.boolean().optional() }),
};

const bulkRowSchema = z.object({
  sport: z.string().trim().min(1).max(120), league: z.string().trim().min(1).max(160), country: z.string().trim().max(120).nullable(),
  home: z.string().trim().min(1).max(160), away: z.string().trim().min(1).max(160), start: z.string().datetime(), market: z.string().trim().min(1).max(160),
  prices: z.tuple([z.number().min(1.01).max(10000), z.number().min(1.01).max(10000), z.number().min(1.01).max(10000)]),
});

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function audit(adminId: string, action: string, entityType: string, entityId: string | null, changes: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({ admin_id: adminId, action, entity_type: entityType, entity_id: entityId, changes });
  if (error) throw error;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAdminApi(req, res);
  if (!auth) return;
  if (!hasAccess(auth.adminRole, "sports_management")) return res.status(403).json({ error: "Sports management authorization required" });

  try {
    if (req.method === "POST" && req.body?.resource === "bulk_import") {
      const rows = z.array(bulkRowSchema).min(1).max(500).safeParse(req.body.rows);
      if (!rows.success) return res.status(400).json({ error: "Bulk import contains invalid rows" });
      const imported = await importRows(rows.data);
      await audit(auth.userId, "sports_catalogue_bulk_imported", "sports_catalogue", null, { imported });
      return res.status(201).json({ success: true, imported });
    }

    if (req.method === "POST") {
      const resource = resourceSchema.safeParse(req.body?.resource);
      if (!resource.success) return res.status(400).json({ error: "Valid catalogue resource is required" });
      const parsed = createSchemas[resource.data].safeParse(req.body.values);
      if (!parsed.success) return res.status(400).json({ error: `Invalid ${resource.data} fields` });
      const values: Record<string, unknown> = { ...parsed.data };
      if (resource.data === "sports" || resource.data === "leagues") values.slug = slugify(String(values.name));
      if (resource.data === "sports" || resource.data === "leagues") values.is_active = true;
      if (resource.data === "events") Object.assign(values, { status: "upcoming", is_featured: false, is_suspended: false });
      if (resource.data === "markets") values.status = "active";
      if (resource.data === "odds") values.is_active = true;
      const { data, error } = await supabaseAdmin.from(resource.data).insert(values).select("id").single();
      if (error) throw error;
      await audit(auth.userId, `${resource.data}_created`, resource.data.slice(0, -1), data.id, values);
      return res.status(201).json({ success: true, id: data.id });
    }

    if (req.method === "PATCH") {
      const resource = resourceSchema.safeParse(req.body?.resource);
      const id = uuid.safeParse(req.body?.id);
      if (!resource.success || !id.success) return res.status(400).json({ error: "Valid catalogue resource and ID are required" });
      const parsed = updateSchemas[resource.data].safeParse(req.body.changes);
      if (!parsed.success || Object.keys(parsed.data).length === 0) return res.status(400).json({ error: "Invalid or empty catalogue update" });
      const changes: Record<string, unknown> = { ...parsed.data };
      if ((resource.data === "sports" || resource.data === "leagues") && typeof changes.name === "string") changes.slug = slugify(changes.name);
      const { error } = await supabaseAdmin.from(resource.data).update(changes).eq("id", id.data);
      if (error) throw error;
      await audit(auth.userId, `${resource.data}_updated`, resource.data.slice(0, -1), id.data, changes);
      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const resource = resourceSchema.safeParse(req.query.resource);
      const id = uuid.safeParse(req.query.id);
      if (!resource.success || !id.success) return res.status(400).json({ error: "Valid catalogue resource and ID are required" });
      const { error } = await supabaseAdmin.from(resource.data).delete().eq("id", id.data);
      if (error) throw error;
      await audit(auth.userId, `${resource.data}_deleted`, resource.data.slice(0, -1), id.data, {});
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Sports catalogue operation failed", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Sports catalogue operation failed" });
  }
}

async function importRows(rows: z.infer<typeof bulkRowSchema>[]) {
  const { data: sportRows, error: sportError } = await supabaseAdmin.from("sports").select("id,name");
  if (sportError) throw sportError;
  const { data: leagueRows, error: leagueError } = await supabaseAdmin.from("leagues").select("id,sport_id,name");
  if (leagueError) throw leagueError;
  const sports = new Map((sportRows || []).map((item) => [item.name.toLowerCase(), item.id]));
  const leagues = new Map((leagueRows || []).map((item) => [`${item.sport_id}:${item.name.toLowerCase()}`, item.id]));

  let imported = 0;
  for (const row of rows) {
    let sportId = sports.get(row.sport.toLowerCase());
    if (!sportId) {
      const { data, error } = await supabaseAdmin.from("sports").insert({ name: row.sport, slug: slugify(row.sport), icon: "🏆", is_active: true }).select("id").single();
      if (error) throw error;
      sportId = data.id;
      sports.set(row.sport.toLowerCase(), sportId);
    }
    const leagueKey = `${sportId}:${row.league.toLowerCase()}`;
    let leagueId = leagues.get(leagueKey);
    if (!leagueId) {
      const { data, error } = await supabaseAdmin.from("leagues").insert({ sport_id: sportId, name: row.league, slug: slugify(row.league), country: row.country, is_active: true }).select("id").single();
      if (error) throw error;
      leagueId = data.id;
      leagues.set(leagueKey, leagueId);
    }
    const { data: event, error: eventError } = await supabaseAdmin.from("events").insert({ sport_id: sportId, league_id: leagueId, home_team: row.home, away_team: row.away, start_time: row.start, status: "upcoming", is_featured: false, is_suspended: false }).select("id").single();
    if (eventError) throw eventError;
    const { data: market, error: marketError } = await supabaseAdmin.from("markets").insert({ event_id: event.id, name: row.market, type: "match_result", line: null, status: "active" }).select("id").single();
    if (marketError) throw marketError;
    const { error: oddsError } = await supabaseAdmin.from("odds").insert([
      { market_id: market.id, selection: row.home, value: row.prices[0], is_active: true },
      { market_id: market.id, selection: "Draw", value: row.prices[1], is_active: true },
      { market_id: market.id, selection: row.away, value: row.prices[2], is_active: true },
    ]);
    if (oddsError) throw oddsError;
    imported += 1;
  }
  return imported;
}
