import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import {
  createSupportTicket,
  getUserTickets,
  getTicketMessages,
  addTicketMessage,
  closeTicket,
  SupportTicket,
  TicketMessage,
  TicketCategory,
  TicketPriority,
} from "@/services/supportService";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  MessageCircle, Plus, AlertCircle, CheckCircle, Clock, X,
  Send, RefreshCw, User, Headphones, ArrowLeft
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";

export default function SupportPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const [newTicket, setNewTicket] = useState({
    subject: "",
    category: "other" as TicketCategory,
    priority: "medium" as TicketPriority,
    message: "",
  });

  useEffect(() => {
    initialize();
  }, []);

  async function initialize() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    
    if (!authUser) {
      router.push("/auth/login");
      return;
    }

    setUser(authUser);

    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .single();

    setProfile(
      profileData ?? {
        email: authUser.email ?? "",
        full_name: authUser.user_metadata?.full_name ?? "Account",
      }
    );

    await loadTickets();
  }

  async function loadTickets() {
    const result = await getUserTickets();
    if (result.success) {
      setTickets(result.tickets);
    } else {
      toast({
        title: "Support tickets unavailable",
        description: result.error || "Could not load your tickets",
        variant: "destructive",
      });
    }
    setLoading(false);
  }

  async function handleCreateTicket() {
    if (!newTicket.subject || !newTicket.message) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }

    setSending(true);
    const result = await createSupportTicket(newTicket);
    
    if (result.success) {
      toast({ title: "Success", description: "Support ticket created" });
      setNewTicket({ subject: "", category: "other", priority: "medium", message: "" });
      setCreateDialogOpen(false);
      await loadTickets();
    } else {
      toast({ title: "Error", description: result.error || "Failed to create ticket", variant: "destructive" });
    }
    setSending(false);
  }

  async function handleViewTicket(ticket: SupportTicket) {
    setSelectedTicket(ticket);
    const result = await getTicketMessages(ticket.id);
    if (result.success) {
      setMessages(result.messages);
    }
    setViewDialogOpen(true);
  }

  async function handleSendMessage() {
    if (!selectedTicket || !newMessage.trim()) return;

    setSending(true);
    const result = await addTicketMessage(selectedTicket.id, newMessage);
    
    if (result.success && result.message) {
      setMessages((prev) => [...prev, result.message]);
      setNewMessage("");
      toast({ title: "Message sent" });
    } else {
      toast({ title: "Error", description: result.error, variant: "destructive" });
    }
    setSending(false);
  }

  async function handleCloseTicket(ticketId: string) {
    if (!window.confirm("Close this ticket? You can still view it later.")) return;

    const result = await closeTicket(ticketId);
    if (result.success) {
      toast({ title: "Ticket closed" });
      setViewDialogOpen(false);
      await loadTickets();
    }
  }

  const openTickets = tickets.filter(t => t.status !== "closed" && t.status !== "resolved");
  const closedTickets = tickets.filter(t => t.status === "closed" || t.status === "resolved");

  function getStatusBadge(status: string) {
    const variants: Record<string, { variant: any; icon: any; label: string }> = {
      open: { variant: "outline", icon: AlertCircle, label: "Open" },
      in_progress: { variant: "default", icon: Clock, label: "In Progress" },
      waiting_response: { variant: "outline", icon: MessageCircle, label: "Waiting" },
      resolved: { variant: "default", icon: CheckCircle, label: "Resolved" },
      closed: { variant: "secondary", icon: X, label: "Closed" },
    };

    const config = variants[status] || variants.open;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className={status === "resolved" ? "bg-success/15 text-success" : ""}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
      </Badge>
    );
  }

  function getPriorityColor(priority: string) {
    const colors: Record<string, string> = {
      low: "text-muted-foreground",
      medium: "text-warning",
      high: "text-danger",
      urgent: "text-danger font-bold",
    };
    return colors[priority] || colors.medium;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background pb-14 lg:pb-0">
      <Header
        user={user ? { email: profile?.email || user.email || "", balance: 0 } : null}
        onAuthClick={() => router.push("/auth/login")}
      />

      <main className="flex-1 container py-4 md:py-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Link href="/account">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Headphones className="h-6 w-6 text-primary" />
                  Support Center
                </h1>
                <p className="text-sm text-muted-foreground">
                  Get help with your questions and issues
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => loadTickets()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Ticket
              </Button>
            </div>
          </div>

          <Tabs defaultValue="open" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="open">
                Open Tickets ({openTickets.length})
              </TabsTrigger>
              <TabsTrigger value="closed">
                Closed Tickets ({closedTickets.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="open" className="space-y-3">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2].map(i => (
                    <div key={i} className="h-32 animate-pulse rounded-lg bg-surface" />
                  ))}
                </div>
              ) : openTickets.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <MessageCircle className="h-12 w-12 mb-3 text-muted-foreground" />
                    <p className="font-medium">No open tickets</p>
                    <p className="text-sm text-muted-foreground mb-4">Create a ticket to get help from our support team</p>
                    <Button onClick={() => setCreateDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Ticket
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                openTickets.map(ticket => (
                  <Card key={ticket.id} className="surface hover:border-primary/30 transition-colors cursor-pointer" onClick={() => handleViewTicket(ticket)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="font-semibold mb-1">{ticket.subject}</h3>
                          <p className="text-xs text-muted-foreground capitalize">
                            {ticket.category} · <span className={getPriorityColor(ticket.priority)}>{ticket.priority} priority</span>
                          </p>
                        </div>
                        {getStatusBadge(ticket.status)}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        {ticket.message}
                      </p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Created: {new Date(ticket.created_at).toLocaleString()}</span>
                        <span>Updated: {new Date(ticket.updated_at).toLocaleString()}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="closed" className="space-y-3">
              {closedTickets.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <CheckCircle className="h-12 w-12 mb-3 text-muted-foreground" />
                    <p className="font-medium">No closed tickets</p>
                    <p className="text-sm text-muted-foreground">Your resolved tickets will appear here</p>
                  </CardContent>
                </Card>
              ) : (
                closedTickets.map(ticket => (
                  <Card key={ticket.id} className="surface opacity-75 hover:opacity-100 transition-opacity cursor-pointer" onClick={() => handleViewTicket(ticket)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="font-semibold mb-1">{ticket.subject}</h3>
                          <p className="text-xs text-muted-foreground capitalize">
                            {ticket.category} · {ticket.priority} priority
                          </p>
                        </div>
                        {getStatusBadge(ticket.status)}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {ticket.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Updated: {new Date(ticket.updated_at).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Create Ticket Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Support Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={newTicket.subject}
                onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                placeholder="Brief description of your issue"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="category">Category</Label>
                <Select value={newTicket.category} onValueChange={(v) => setNewTicket({ ...newTicket, category: v as TicketCategory })}>
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="account">Account</SelectItem>
                    <SelectItem value="betting">Betting</SelectItem>
                    <SelectItem value="payments">Payments</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="priority">Priority</Label>
                <Select value={newTicket.priority} onValueChange={(v) => setNewTicket({ ...newTicket, priority: v as TicketPriority })}>
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="message">Description</Label>
              <Textarea
                id="message"
                value={newTicket.message}
                onChange={(e) => setNewTicket({ ...newTicket, message: e.target.value })}
                placeholder="Provide detailed information about your issue..."
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTicket} disabled={sending}>
              {sending ? "Creating..." : "Create Ticket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Ticket Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <DialogTitle>{selectedTicket?.subject}</DialogTitle>
                <p className="text-sm text-muted-foreground capitalize mt-1">
                  {selectedTicket?.category} · {selectedTicket?.priority} priority
                </p>
              </div>
              {selectedTicket && getStatusBadge(selectedTicket.status)}
            </div>
          </DialogHeader>

          <ScrollArea className="h-96 pr-4">
            <div className="space-y-4">
              {messages.map(msg => (
                <div key={msg.id} className={`flex gap-3 ${msg.is_staff ? "flex-row" : "flex-row-reverse"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.is_staff ? "bg-primary/10" : "bg-accent/10"}`}>
                    {msg.is_staff ? (
                      <Headphones className="h-4 w-4 text-primary" />
                    ) : (
                      <User className="h-4 w-4 text-accent" />
                    )}
                  </div>
                  <div className={`flex-1 ${msg.is_staff ? "text-left" : "text-right"}`}>
                    <div className={`inline-block p-3 rounded-lg ${msg.is_staff ? "bg-surface" : "bg-primary/10"}`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(msg.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {selectedTicket && selectedTicket.status !== "closed" && (
            <div className="space-y-3 border-t pt-4">
              <Textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type your message..."
                rows={3}
              />
              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => handleCloseTicket(selectedTicket.id)}>
                  Close Ticket
                </Button>
                <Button onClick={handleSendMessage} disabled={sending || !newMessage.trim()}>
                  <Send className="h-4 w-4 mr-2" />
                  {sending ? "Sending..." : "Send Message"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Footer />
      <MobileBottomNav />
    </div>
  );
}