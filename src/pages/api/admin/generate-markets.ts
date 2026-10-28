import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminApi } from "@/lib/server/requireAdminApi";
import { hasAccess } from "@/lib/adminRoles";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const adminAuth = await requireAdminApi(req, res);
  if (!adminAuth) return;

  if (!hasAccess(adminAuth.adminRole, "sports_management")) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const demoToolsEnabled =
    process.env.PRODUCTION_MODE !== "true" &&
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" &&
    process.env.NEXT_PUBLIC_ENABLE_DEMO_BACKEND === "true";
  if (!demoToolsEnabled) {
    return res.status(403).json({
      error: "Mock market generation is disabled outside an explicitly enabled demo environment",
    });
  }

  const { eventId } = req.body;
  if (!eventId) {
    return res.status(400).json({ error: "eventId is required" });
  }

  try {
    // Mock implementation - in production this would call the actual market generation service
    return res.status(200).json({
      success: true,
      message: "Markets generated successfully",
      eventId,
      marketsCreated: 0,
    });
  } catch (error: any) {
    console.error("Failed to generate markets:", error);
    return res.status(500).json({
      error: "Failed to generate markets",
      details: error.message,
    });
  }
}
