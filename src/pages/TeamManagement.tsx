import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, UserPlus, Trash2, Shield, ShieldCheck, Eye, Mail, Clock, RefreshCw } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface TeamMember {
  user_id: string;
  role: AppRole;
  email: string;
  display_name: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  invited_at: string;
}

const roleIcons: Record<AppRole, typeof Shield> = {
  admin: ShieldCheck,
  processor: Shield,
  viewer: Eye,
};

const roleColors: Record<AppRole, string> = {
  admin: "bg-destructive/10 text-destructive border-destructive/20",
  processor: "bg-primary/10 text-primary border-primary/20",
  viewer: "bg-muted text-muted-foreground border-border",
};

export default function TeamManagement() {
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("processor");

  const isAdmin = role === "admin";

  const getAuthToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Not authenticated");
    return token;
  };

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rolesErr) throw rolesErr;

      const { data: profiles, error: profErr } = await supabase
        .from("profiles_safe" as any)
        .select("user_id, email, display_name") as { data: { user_id: string; email: string; display_name: string | null }[] | null; error: any };
      if (profErr) throw profErr;

      const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
      return roles.map((r) => ({
        user_id: r.user_id,
        role: r.role,
        email: profileMap.get(r.user_id)?.email || "Unknown",
        display_name: profileMap.get(r.user_id)?.display_name || null,
      })) as TeamMember[];
    },
  });

  const { data: pendingInvites = [], isLoading: pendingLoading } = useQuery({
    queryKey: ["pending-invites"],
    enabled: isAdmin,
    queryFn: async () => {
      const token = await getAuthToken();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) throw new Error("Failed to fetch pending invites");
      const data = await resp.json();
      return (data.pending || []) as PendingInvite[];
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const token = await getAuthToken();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: inviteEmail,
            role: inviteRole,
            redirectTo: `${window.location.origin}/accept-invite`,
          }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to invite member");
      }
      return resp.json();
    },
    onSuccess: () => {
      toast.success(`Invite sent to ${inviteEmail}`);
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const token = await getAuthToken();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ email, redirectTo: `${window.location.origin}/accept-invite` }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to resend invite");
      }
    },
    onSuccess: (_, email) => {
      toast.success(`Invite resent to ${email}`);
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const token = await getAuthToken();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to revoke invite");
      }
    },
    onSuccess: () => {
      toast.success("Invite revoked");
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      const { error } = await supabase
        .from("user_roles")
        .update({ role: newRole })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const token = await getAuthToken();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to remove member");
      }
    },
    onSuccess: () => {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invites"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isAdmin) {
    return (
      <div className="space-y-6 max-w-4xl">
        <h1 className="text-2xl font-bold text-foreground">Team</h1>
        <div className="vault-card p-8 text-center">
          <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Only admins can manage team members.</p>
        </div>
        <div className="vault-card divide-y divide-border">
          {members.map((m) => {
            const Icon = roleIcons[m.role];
            const hideEmail = m.role === "admin";
            const avatarInitials = hideEmail ? "AD" : m.email.substring(0, 2).toUpperCase();
            return (
              <div key={m.user_id} className="flex items-center gap-3 p-4">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary">{avatarInitials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{hideEmail ? (m.display_name || "Admin") : (m.display_name || m.email)}</p>
                  {!hideEmail && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                </div>
                <Badge variant="outline" className={`${roleColors[m.role]} gap-1`}>
                  <Icon className="h-3 w-3" /> {m.role}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Team Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Invite and manage team members.</p>
      </div>

      {/* Invite form */}
      <div className="vault-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <UserPlus className="h-4 w-4" /> Invite Team Member
        </h2>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5" />
          An email with a secure sign-in link will be sent to the invitee.
        </p>
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Email address"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="processor">Processor</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => inviteMutation.mutate()}
            disabled={!inviteEmail || inviteMutation.isPending}
          >
            {inviteMutation.isPending ? "Sending..." : "Send Invite"}
          </Button>
        </div>
      </div>


      {/* Pending invitations */}
      {(pendingInvites.length > 0 || pendingLoading) && (
        <div className="vault-card divide-y divide-border">
          <div className="p-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              Pending Invitations ({pendingInvites.length})
            </h2>
          </div>
          {pendingLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            pendingInvites.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3 p-4">
                <div className="h-9 w-9 rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited {new Date(invite.invited_at).toLocaleDateString()} · Awaiting account setup
                  </p>
                </div>
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-300/50 text-xs">
                  Pending
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Resend invite"
                  onClick={() => resendInviteMutation.mutate(invite.email)}
                  disabled={resendInviteMutation.isPending}
                >
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  title="Revoke invite"
                  onClick={() => {
                    if (confirm(`Revoke invite for ${invite.email}?`)) {
                      revokeInviteMutation.mutate(invite.id);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Members list */}
      <div className="vault-card divide-y divide-border">
        <div className="p-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Members ({members.length})
          </h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
        ) : (
          members.map((m) => {
            const Icon = roleIcons[m.role];
            const isSelf = m.user_id === user?.id;
            return (
              <div key={m.user_id} className="flex items-center gap-3 p-4">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary">
                    {m.email.substring(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {m.display_name || m.email} {isSelf && <span className="text-muted-foreground">(you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                </div>
                <Select
                  value={m.role}
                  onValueChange={(v) => updateRoleMutation.mutate({ userId: m.user_id, newRole: v as AppRole })}
                  disabled={isSelf}
                >
                  <SelectTrigger className="w-32">
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3 w-3" />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="processor">Processor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                {!isSelf && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Remove ${m.email} from the team?`)) {
                        removeMutation.mutate(m.user_id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
