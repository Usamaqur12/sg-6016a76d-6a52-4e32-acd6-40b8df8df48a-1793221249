import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, Clock, Mail, MessageSquare, RefreshCw, Send, User } from "lucide-react";
import { canAccessAdminArea } from "@/lib/adminRoles";
import { useToast } from "@/hooks/use-toast";

type TicketFilter = "all" | "open" | "in_progress" | "resolved";
type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

interface TicketView {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: string;
  createdAt: string;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  author_role: "customer" | "staff";
  message: string;
  is_internal: boolean;
  created_at: string;
}

export default function AdminSupport() {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<TicketFilter>("open");
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const db = supabase as any;

  useEffect(() => { void initialize(); }, []);
  useEffect(() => { if (selectedId) void loadMessages(selectedId); else setMessages([]); }, [selectedId]);

  async function adminFetch(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Support request failed");
    return body;
  }

  async function initialize() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { await router.push("/auth/login"); return; }
    const { data: profile } = await supabase.from("profiles").select("admin_role").eq("id", user.id).single();
    if (!profile || !canAccessAdminArea(profile.admin_role, "support")) { await router.push("/"); return; }
    await loadTickets();
  }

  async function loadTickets() {
    setLoading(true);
    const ticketResult = await supabase.from("support_tickets").select("id, user_id, subject, message, status, priority, created_at").order("created_at", { ascending: false });
    if (ticketResult.error) { toast({ title: "Tickets load failed", description: ticketResult.error.message, variant: "destructive" }); setLoading(false); return; }
    const rawTickets = ticketResult.data ?? [];
    const userIds = [...new Set(rawTickets.map((ticket) => ticket.user_id))];
    const profileResult = userIds.length > 0
      ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
      : { data: [], error: null };
    if (profileResult.error) { toast({ title: "Customer profiles load failed", description: profileResult.error.message, variant: "destructive" }); }
    const profiles = new Map((profileResult.data ?? []).map((profile: any) => [profile.id, profile]));
    setTickets(rawTickets.map((ticket) => {
      const profile = profiles.get(ticket.user_id) as any;
      return {
        id: ticket.id,
        userId: ticket.user_id,
        userName: profile?.full_name || "Customer",
        userEmail: profile?.email || "Email unavailable",
        subject: ticket.subject,
        message: ticket.message,
        status: ticket.status as TicketStatus,
        priority: ticket.priority ?? "medium",
        createdAt: ticket.created_at ?? new Date().toISOString(),
      };
    }));
    setLoading(false);
  }

  async function advanceTicket(ticket: TicketView) {
    const nextStatus: TicketStatus = ticket.status === "open" ? "in_progress" : "resolved";
    setProcessingId(ticket.id);
    try {
      await adminFetch(`/api/admin/support/tickets/${ticket.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, status: nextStatus } : item));
      toast({ title: nextStatus === "in_progress" ? "Ticket assigned to progress" : "Ticket resolved" });
    } catch (error) {
      toast({ title: "Ticket update failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
    setProcessingId(null);
  }

  async function loadMessages(ticketId: string) {
    const { data, error } = await db.from("support_ticket_messages").select("*").eq("ticket_id", ticketId).order("created_at", { ascending: true });
    if (error) toast({ title: "Conversation load failed", description: error.message, variant: "destructive" });
    setMessages((data || []) as TicketMessage[]);
  }

  async function sendReply(ticket: TicketView, status: TicketStatus | null = null) {
    if (!reply.trim()) return;
    setProcessingId(ticket.id);
    const { error } = await db.rpc("reply_support_ticket", { p_ticket_id: ticket.id, p_message: reply, p_internal: isInternal, p_status: status });
    if (error) toast({ title: "Reply failed", description: error.message, variant: "destructive" });
    else {
      setReply("");
      setIsInternal(false);
      await Promise.all([loadMessages(ticket.id), loadTickets()]);
      setSelectedId(ticket.id);
      toast({ title: isInternal ? "Internal note saved" : "Reply sent" });
    }
    setProcessingId(null);
  }

  const filteredTickets = tickets.filter((ticket) => filter === "all" || ticket.status === filter);

  const statusBadge = (status: TicketStatus) => {
    if (status === "open") return <Badge className="bg-warning/10 text-warning border-warning/30">Open</Badge>;
    if (status === "in_progress") return <Badge className="bg-primary/10 text-primary border-primary/30">In Progress</Badge>;
    if (status === "resolved") return <Badge className="bg-success/10 text-success border-success/30">Resolved</Badge>;
    return <Badge variant="outline">Closed</Badge>;
  };

  return (
    <AdminLayout><div className="space-y-6">
      <div className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Support Tickets</h1><p className="text-sm text-muted-foreground">Manage real customer requests</p></div><Button variant="outline" className="gap-2" onClick={() => void loadTickets()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="surface"><CardContent className="p-4 flex items-center gap-3"><Clock className="h-8 w-8 text-warning" /><div><div className="text-2xl font-bold">{tickets.filter((t) => t.status === "open").length}</div><div className="text-xs text-muted-foreground">Open</div></div></CardContent></Card>
        <Card className="surface"><CardContent className="p-4 flex items-center gap-3"><MessageSquare className="h-8 w-8 text-primary" /><div><div className="text-2xl font-bold">{tickets.filter((t) => t.status === "in_progress").length}</div><div className="text-xs text-muted-foreground">In Progress</div></div></CardContent></Card>
        <Card className="surface"><CardContent className="p-4 flex items-center gap-3"><CheckCircle className="h-8 w-8 text-success" /><div><div className="text-2xl font-bold">{tickets.filter((t) => t.status === "resolved").length}</div><div className="text-xs text-muted-foreground">Resolved</div></div></CardContent></Card>
        <Card className="surface"><CardContent className="p-4 flex items-center gap-3"><MessageSquare className="h-8 w-8 text-muted-foreground" /><div><div className="text-2xl font-bold">{tickets.length}</div><div className="text-xs text-muted-foreground">Total</div></div></CardContent></Card>
      </div>
      <Tabs value={filter} onValueChange={(value) => setFilter(value as TicketFilter)}>
        <TabsList><TabsTrigger value="all">All Tickets</TabsTrigger><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="in_progress">In Progress</TabsTrigger><TabsTrigger value="resolved">Resolved</TabsTrigger></TabsList>
        <TabsContent value={filter} className="mt-4"><Card className="surface"><CardContent className="p-4">
          {filteredTickets.length === 0 ? <div className="text-center py-8 text-muted-foreground">{loading ? "Loading tickets…" : "No tickets found"}</div> : <div className="space-y-3">{filteredTickets.map((ticket) => (
            <div key={ticket.id} className="p-4 rounded border border-border"><div className="flex items-start justify-between gap-4 mb-3"><div className="flex items-start gap-3 flex-1"><div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><User className="h-5 w-5 text-primary" /></div><div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2 mb-1"><h3 className="font-semibold text-sm">{ticket.subject}</h3><Badge variant={ticket.priority === "urgent" || ticket.priority === "high" ? "destructive" : "outline"}>{ticket.priority}</Badge></div><div className="text-xs text-muted-foreground flex items-center gap-1 mb-2"><Mail className="h-3 w-3" />{ticket.userName} · {ticket.userEmail}</div><p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.message}</p></div></div>{statusBadge(ticket.status)}</div><div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border"><span className="text-xs text-muted-foreground">{new Date(ticket.createdAt).toLocaleString()}</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedId(selectedId === ticket.id ? null : ticket.id)}>{selectedId === ticket.id ? "Close conversation" : "Open conversation"}</Button>{ticket.status !== "resolved" && ticket.status !== "closed" && <Button size="sm" variant="outline" disabled={processingId === ticket.id} onClick={() => void advanceTicket(ticket)}>{processingId === ticket.id ? "Saving…" : ticket.status === "open" ? "Start handling" : "Mark resolved"}</Button>}</div></div>
              {selectedId === ticket.id && <div className="mt-4 pt-4 border-t border-border space-y-3"><div className="max-h-80 overflow-y-auto space-y-2 rounded-md bg-muted/20 p-3">{messages.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No conversation messages yet.</p> : messages.map((item) => <div key={item.id} className={`flex ${item.author_role === "staff" ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${item.is_internal ? "bg-warning/15 border border-warning/30" : item.author_role === "staff" ? "bg-primary text-primary-foreground" : "bg-muted"}`}><div className="text-[11px] font-semibold mb-1">{item.is_internal ? "Internal note" : item.author_role === "staff" ? "Support" : "Customer"}</div><p className="whitespace-pre-wrap">{item.message}</p><div className="text-[10px] opacity-70 mt-1">{new Date(item.created_at).toLocaleString()}</div></div></div>)}</div><Textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={3} placeholder={isInternal ? "Write an internal note…" : "Write a customer reply…"} /><div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isInternal} onChange={(event) => setIsInternal(event.target.checked)} />Internal note (customer cannot see)</label><div className="flex gap-2"><Button size="sm" variant="outline" disabled={processingId === ticket.id || !reply.trim()} onClick={() => void sendReply(ticket, "resolved")}>Reply & resolve</Button><Button size="sm" className="gap-2" disabled={processingId === ticket.id || !reply.trim()} onClick={() => void sendReply(ticket)}><Send className="h-3.5 w-3.5" />{processingId === ticket.id ? "Sending…" : isInternal ? "Save note" : "Send reply"}</Button></div></div></div>}
            </div>
          ))}</div>}
        </CardContent></Card></TabsContent>
      </Tabs>
    </div></AdminLayout>
  );
}
