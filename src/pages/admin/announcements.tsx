import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, Edit, Trash2, Megaphone, AlertTriangle, Info, CheckCircle, Calendar, Clock
} from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "success" | "urgent";
  priority: number;
  is_active: boolean;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
}

export default function AdminAnnouncements() {
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  
  const [formData, setFormData] = useState({
    title: "",
    message: "",
    type: "info" as "info" | "warning" | "success" | "urgent",
    priority: 0,
    is_active: true,
    starts_at: new Date().toISOString().slice(0, 16),
    expires_at: "",
  });

  useEffect(() => {
    void loadAnnouncements();
  }, []);

  async function adminFetch(url: string, init?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Admin session expired");
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}`, ...(init?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Announcement request failed");
    return body;
  }

  async function loadAnnouncements() {
    setLoading(true);

    try {
      const body = await adminFetch("/api/admin/announcements");
      const typedAnnouncements = (body.announcements || []).map((announcement: Announcement) => ({
        ...announcement,
        type: announcement.type as Announcement["type"],
      }));
      setAnnouncements(typedAnnouncements);
    } catch (error) {
      console.error("Error loading announcements:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load announcements",
        variant: "destructive",
      });
    }

    setLoading(false);
  }

  async function handleSave() {
    if (!formData.title || !formData.message) {
      toast({
        title: "Validation Error",
        description: "Title and message are required",
        variant: "destructive",
      });
      return;
    }

    setProcessing(true);

    try {
      const announcementData = {
        ...formData,
        expires_at: formData.expires_at || null,
      };

      if (editingId) {
        await adminFetch("/api/admin/announcements", { method: "PATCH", body: JSON.stringify({ id: editingId, ...announcementData }) });

        toast({
          title: "Announcement Updated",
          description: "The announcement has been updated successfully",
        });
      } else {
        await adminFetch("/api/admin/announcements", { method: "POST", body: JSON.stringify(announcementData) });

        toast({
          title: "Announcement Created",
          description: "The announcement has been published successfully",
        });
      }

      setShowDialog(false);
      setEditingId(null);
      resetForm();
      await loadAnnouncements();
    } catch (error) {
      console.error("Error saving announcement:", error);
      toast({
        title: "Error",
        description: "Failed to save announcement",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this announcement?")) return;

    try {
      await adminFetch(`/api/admin/announcements?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      toast({ title: "Announcement Deleted", description: "The announcement has been removed" });
      await loadAnnouncements();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete announcement",
        variant: "destructive",
      });
    }
  }

  async function toggleActive(id: string, currentStatus: boolean) {
    const current = announcements.find((announcement) => announcement.id === id);
    if (!current) return;
    try {
      await adminFetch("/api/admin/announcements", {
        method: "PATCH",
        body: JSON.stringify({ ...current, id, is_active: !currentStatus }),
      });
      await loadAnnouncements();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update announcement status",
        variant: "destructive",
      });
    }
  }

  function openEditDialog(announcement: Announcement) {
    setEditingId(announcement.id);
    setFormData({
      title: announcement.title,
      message: announcement.message,
      type: announcement.type,
      priority: announcement.priority,
      is_active: announcement.is_active,
      starts_at: new Date(announcement.starts_at).toISOString().slice(0, 16),
      expires_at: announcement.expires_at ? new Date(announcement.expires_at).toISOString().slice(0, 16) : "",
    });
    setShowDialog(true);
  }

  function resetForm() {
    setFormData({
      title: "",
      message: "",
      type: "info",
      priority: 0,
      is_active: true,
      starts_at: new Date().toISOString().slice(0, 16),
      expires_at: "",
    });
  }

  function getTypeIcon(type: string) {
    switch (type) {
      case "urgent":
        return <AlertTriangle className="h-4 w-4 text-danger" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case "success":
        return <CheckCircle className="h-4 w-4 text-success" />;
      default:
        return <Info className="h-4 w-4 text-primary" />;
    }
  }

  function getTypeBadge(type: string) {
    const variants: Record<string, string> = {
      urgent: "bg-danger text-danger-foreground",
      warning: "bg-warning text-warning-foreground",
      success: "bg-success text-success-foreground",
      info: "bg-primary text-primary-foreground",
    };
    return <Badge className={variants[type]}>{type.toUpperCase()}</Badge>;
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Global Announcements</h1>
            <p className="text-muted-foreground">
              Create and manage platform-wide announcements for users
            </p>
          </div>
          <Button onClick={() => {
            resetForm();
            setShowDialog(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            New Announcement
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-lg animate-pulse bg-surface" />
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <Card className="surface">
            <CardContent className="p-12 text-center">
              <Megaphone className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                No announcements yet. Create your first announcement to inform users.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {announcements.map((announcement) => (
              <Card key={announcement.id} className="surface">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                        {getTypeIcon(announcement.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold">{announcement.title}</h3>
                          {getTypeBadge(announcement.type)}
                          <Badge variant={announcement.is_active ? "default" : "secondary"}>
                            {announcement.is_active ? "Active" : "Inactive"}
                          </Badge>
                          {announcement.priority > 0 && (
                            <Badge variant="outline">Priority: {announcement.priority}</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{announcement.message}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Starts: {new Date(announcement.starts_at).toLocaleDateString()}
                          </div>
                          {announcement.expires_at && (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Expires: {new Date(announcement.expires_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleActive(announcement.id, announcement.is_active)}
                      >
                        {announcement.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDialog(announcement)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(announcement.id)}
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => {
        if (!open) {
          setShowDialog(false);
          setEditingId(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit" : "Create"} Announcement</DialogTitle>
            <DialogDescription>
              {editingId ? "Update the announcement details" : "Create a new platform-wide announcement"}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Announcement title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">Message *</Label>
              <Textarea
                id="message"
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                placeholder="Announcement message"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: any) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Input
                  id="priority"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="starts_at">Start Date</Label>
                <Input
                  id="starts_at"
                  type="datetime-local"
                  value={formData.starts_at}
                  onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expires_at">Expiry Date (Optional)</Label>
                <Input
                  id="expires_at"
                  type="datetime-local"
                  value={formData.expires_at}
                  onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Active (visible to users)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(false);
                setEditingId(null);
                resetForm();
              }}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={processing || !formData.title || !formData.message}
            >
              {processing ? "Saving..." : editingId ? "Update Announcement" : "Create Announcement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
