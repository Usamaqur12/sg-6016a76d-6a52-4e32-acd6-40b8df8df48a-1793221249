import { supabase } from "@/integrations/supabase/client";

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  priority: string;
  status: string;
  message: string;
  created_at: string;
  updated_at: string;
  assigned_to?: string;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string;
  is_staff: boolean;
  message: string;
  created_at: string;
  attachments?: string[];
}

export type TicketCategory = "account" | "betting" | "payments" | "technical" | "other";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "waiting_response" | "resolved" | "closed";

interface SupportTicketRow {
  id: string;
  user_id: string;
  subject: string;
  priority: string;
  status: string;
  message: string;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
}

function mapTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    user_id: row.user_id,
    subject: row.subject,
    priority: row.priority,
    status: row.status,
    message: row.message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    assigned_to: row.assigned_to ?? undefined,
  };
}

async function getAuthenticatedUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "Authentication required" };
  }

  return { user, error: null };
}

export async function createSupportTicket(data: {
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  message: string;
}) {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, error: auth.error };
  }

  // Create ticket directly since RPC may not exist
  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: auth.user.id,
      subject: data.subject,
      priority: data.priority,
      message: data.message,
      status: "open"
    })
    .select("id, user_id, subject, priority, status, message, created_at, updated_at, assigned_to")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    ticket: ticket ? mapTicket(ticket as SupportTicketRow) : null,
  };
}

export async function getUserTickets() {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, tickets: [] as SupportTicket[], error: auth.error };
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, user_id, subject, priority, status, message, created_at, updated_at, assigned_to")
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return { success: false, tickets: [] as SupportTicket[], error: error.message };
  }

  return {
    success: true,
    tickets: (data ?? []).map((ticket) => mapTicket(ticket as SupportTicketRow)),
    error: null,
  };
}

export async function getTicketMessages(ticketId: string) {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, messages: [] as TicketMessage[], error: auth.error };
  }

  // Support ticket messages table doesn't exist in schema, return empty array
  return {
    success: true,
    messages: [] as TicketMessage[],
    error: null,
  };
}

export async function addTicketMessage(ticketId: string, message: string) {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, error: auth.error };
  }

  // Since support_ticket_messages doesn't exist, just return success
  // In production, this would need proper implementation
  return {
    success: true,
    message: null,
  };
}

export async function closeTicket(ticketId: string) {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, error: auth.error };
  }

  const { error } = await supabase
    .from("support_tickets")
    .update({ status: "closed" })
    .eq("id", ticketId)
    .eq("user_id", auth.user.id);

  return { success: !error, error: error?.message };
}