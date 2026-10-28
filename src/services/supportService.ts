import { supabase } from "@/integrations/supabase/client";

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  category: string;
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
  category: string;
  priority: string;
  status: string;
  message: string;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
}

interface SupportTicketMessageRow {
  id: string;
  ticket_id: string;
  author_id: string;
  author_role: string;
  message: string;
  created_at: string;
}

function mapTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    user_id: row.user_id,
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    message: row.message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    assigned_to: row.assigned_to ?? undefined,
  };
}

function mapMessage(row: SupportTicketMessageRow): TicketMessage {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    user_id: row.author_id,
    is_staff: row.author_role === "staff",
    message: row.message,
    created_at: row.created_at,
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

  const { data: ticketId, error } = await supabase.rpc("create_support_ticket", {
    p_subject: data.subject,
    p_message: data.message,
    p_priority: data.priority,
    p_category: data.category,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const createdTicketId = ticketId as string | null;
  if (!createdTicketId) {
    return { success: false, error: "Ticket could not be created" };
  }

  const { data: ticketRow, error: ticketError } = await supabase
    .from("support_tickets")
    .select("id, user_id, subject, category, priority, status, message, created_at, updated_at, assigned_to")
    .eq("id", createdTicketId)
    .maybeSingle();

  if (ticketError) {
    return { success: false, error: ticketError.message };
  }

  return {
    success: true,
    ticket: ticketRow ? mapTicket(ticketRow as SupportTicketRow) : null,
  };
}

export async function getUserTickets() {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, tickets: [] as SupportTicket[], error: auth.error };
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, user_id, subject, category, priority, status, message, created_at, updated_at, assigned_to")
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

  const { data, error } = await supabase
    .from("support_ticket_messages")
    .select("id, ticket_id, author_id, author_role, message, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) {
    return { success: false, messages: [] as TicketMessage[], error: error.message };
  }

  return {
    success: true,
    messages: (data ?? []).map((message) => mapMessage(message as SupportTicketMessageRow)),
    error: null,
  };
}

export async function addTicketMessage(ticketId: string, message: string) {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, error: auth.error };
  }

  const { data: messageId, error } = await supabase.rpc("reply_support_ticket", {
    p_ticket_id: ticketId,
    p_message: message,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const createdMessageId = messageId as string | null;
  if (!createdMessageId) {
    return { success: false, error: "Message could not be created" };
  }

  const { data: messageRow, error: messageError } = await supabase
    .from("support_ticket_messages")
    .select("id, ticket_id, author_id, author_role, message, created_at")
    .eq("id", createdMessageId)
    .maybeSingle();

  if (messageError || !messageRow) {
    return { success: false, error: messageError?.message || "Message could not be loaded" };
  }

  return {
    success: true,
    message: mapMessage(messageRow as SupportTicketMessageRow),
  };
}

export async function closeTicket(ticketId: string) {
  const auth = await getAuthenticatedUser();
  if (!auth.user) {
    return { success: false, error: auth.error };
  }

  const { error } = await supabase.rpc("close_support_ticket", {
    p_ticket_id: ticketId,
  });

  return { success: !error, error: error?.message };
}