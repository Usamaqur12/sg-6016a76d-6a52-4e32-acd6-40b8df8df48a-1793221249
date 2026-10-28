import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Headphones, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { siteConfig } from "@/config/site";

interface Ticket { id: string; subject: string; message: string; status: string; priority: string; created_at: string; updated_at: string; }
interface TicketMessage { id: string; ticket_id: string; author_role: "customer" | "staff"; message: string; is_internal: boolean; created_at: string; }

export default function ContactPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("medium");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const db = supabase as any;

  useEffect(() => { void initialize(); }, []);
  useEffect(() => { if (selectedId) void loadMessages(selectedId); else setMessages([]); }, [selectedId]);

  async function initialize() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    setUser(authUser);
    if (authUser) {
      const { data } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
      setProfile(data);
      await loadTickets();
    } else setLoading(false);
  }

  async function loadTickets(selectTicketId?: string) {
    setLoading(true);
    const { data, error } = await db.from("support_tickets").select("*").order("updated_at", { ascending: false });
    if (error) toast({ title: "Tickets could not be loaded", description: error.message, variant: "destructive" });
    const nextTickets = (data || []) as Ticket[];
    setTickets(nextTickets);
    setSelectedId(selectTicketId || selectedId || nextTickets[0]?.id || null);
    setLoading(false);
  }

  async function loadMessages(ticketId: string) {
    const { data, error } = await db.from("support_ticket_messages").select("*").eq("ticket_id", ticketId).eq("is_internal", false).order("created_at", { ascending: true });
    if (error) toast({ title: "Conversation could not be loaded", description: error.message, variant: "destructive" });
    setMessages((data || []) as TicketMessage[]);
  }

  async function createTicket(event: React.FormEvent) {
    event.preventDefault();
    if (!user) { await router.push("/auth/login?next=/contact"); return; }
    setBusy(true);
    const { data, error } = await db.rpc("create_support_ticket", { p_subject: subject, p_message: message, p_priority: priority });
    if (error) toast({ title: "Ticket could not be created", description: error.message, variant: "destructive" });
    else {
      setSubject(""); setMessage(""); setPriority("medium");
      toast({ title: "Support ticket created", description: `Reference ${String(data).slice(0, 12)}` });
      await loadTickets(String(data));
    }
    setBusy(false);
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    const { error } = await db.rpc("reply_support_ticket", { p_ticket_id: selectedId, p_message: reply, p_internal: false, p_status: null });
    if (error) toast({ title: "Reply could not be sent", description: error.message, variant: "destructive" });
    else { setReply(""); await Promise.all([loadMessages(selectedId), loadTickets(selectedId)]); toast({ title: "Reply sent" }); }
    setBusy(false);
  }

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId);

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header user={profile ? { email: user?.email || "", balance: Number(profile.demo_balance || 0) } : null} onAuthClick={() => router.push("/auth/login?next=/contact")} />
      <main className="flex-1 container py-8 px-4"><div className="max-w-6xl mx-auto space-y-6">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-2">Customer care</p><h1 className="text-3xl font-black">Support center</h1><p className="text-muted-foreground mt-2">Create a ticket, follow its status and reply in one conversation. Never send passwords, private keys or card details.</p></div>

        {!user ? <Card className="surface"><CardContent className="py-12 text-center"><Headphones className="h-12 w-12 mx-auto text-primary mb-4" /><h2 className="text-xl font-bold">Sign in to contact support</h2><p className="text-muted-foreground my-2">Tickets are protected inside your account.</p><Button onClick={() => router.push("/auth/login?next=/contact")}>Sign in</Button><p className="text-xs text-muted-foreground mt-5">Contact our support team at <a href="mailto:support@primebet.com" className="text-primary hover:underline">support@primebet.com</a></p></CardContent></Card> : <div className="grid lg:grid-cols-[360px_1fr] gap-5">
          <div className="space-y-5">
            <Card className="surface"><CardHeader><CardTitle className="text-lg">New ticket</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={createTicket}>
              <div className="space-y-2"><Label htmlFor="support-subject">Subject</Label><Input id="support-subject" value={subject} onChange={(event) => setSubject(event.target.value)} minLength={3} maxLength={160} required placeholder="What do you need help with?" /></div>
              <div className="space-y-2"><Label htmlFor="support-priority">Priority</Label><select id="support-priority" className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
              <div className="space-y-2"><Label htmlFor="support-message">Message</Label><Textarea id="support-message" value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} maxLength={5000} required rows={5} placeholder="Describe the issue and include any relevant bet or transaction reference." /></div>
              <Button className="w-full gap-2" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Create ticket</Button>
            </form></CardContent></Card>

            <Card className="surface"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-lg">Your tickets</CardTitle><Button variant="ghost" size="icon" onClick={() => void loadTickets()}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button></CardHeader><CardContent className="space-y-2">
              {tickets.length === 0 ? <p className="text-sm text-muted-foreground">No tickets yet.</p> : tickets.map((ticket) => <button type="button" key={ticket.id} onClick={() => setSelectedId(ticket.id)} className={`w-full text-left rounded-md border p-3 transition-colors ${selectedId === ticket.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}><div className="flex items-start justify-between gap-2"><span className="font-medium text-sm">{ticket.subject}</span><Badge variant="outline">{ticket.status.replace("_", " ")}</Badge></div><p className="text-xs text-muted-foreground mt-2">{new Date(ticket.updated_at || ticket.created_at).toLocaleString()}</p></button>)}
            </CardContent></Card>
          </div>

          <Card className="surface min-h-[560px]"><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" />{selectedTicket?.subject || "Select a ticket"}</CardTitle>{selectedTicket && <div className="flex gap-2"><Badge>{selectedTicket.status.replace("_", " ")}</Badge><Badge variant="outline">{selectedTicket.priority}</Badge></div>}</CardHeader><CardContent className="flex min-h-[440px] flex-col">
            {!selectedTicket ? <div className="flex-1 grid place-items-center text-muted-foreground">Choose a ticket to view its conversation.</div> : <><div className="flex-1 space-y-3 mb-5">{messages.map((item) => <div key={item.id} className={`flex ${item.author_role === "customer" ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-lg px-4 py-3 ${item.author_role === "customer" ? "bg-primary text-primary-foreground" : "bg-muted"}`}><p className="text-xs font-semibold mb-1">{item.author_role === "customer" ? "You" : "Support"}</p><p className="text-sm whitespace-pre-wrap">{item.message}</p><p className="text-[11px] opacity-70 mt-2">{new Date(item.created_at).toLocaleString()}</p></div></div>)}</div><form className="flex gap-2" onSubmit={sendReply}><Textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} maxLength={5000} required placeholder="Write a reply…" /><Button type="submit" size="icon" className="shrink-0" disabled={busy || !reply.trim()}><Send className="h-4 w-4" /></Button></form></>}
          </CardContent></Card>
        </div>}
      </div></main>
      <Footer /><MobileBottomNav />
    </div>
  );
}
