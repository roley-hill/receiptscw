import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, UserPlus, Trash2, Shield, ShieldCheck, Eye } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface TeamMember {
  user_id: string;
  role: AppRole;
  email: string;
  display_name: string | null;
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
  const [invitePassword, setInvitePassword] = useState("");

  const isAdmin = role === "admin";

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rolesErr) throw rolesErr;

      const { data: profiles, error: profErr } = await supabase
        .from("profiles")
        .select("user_id, email, display_name");
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

  const inviteMutation = useMutation({
    mutationFn: async () => {
      // Use the edge function to create user (admin action)
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: inviteEmail, password: invitePassword, role: inviteRole }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to invite member");
      }
      return resp.json();
    },
    onSuccess: () => {
      toast.success(`Invited ${inviteEmail} as ${inviteRole}`);
      setInviteEmail("");
      setInvitePassword("");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-team-member`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
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
        {/* Still show read-only list */}
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
          <UserPlus className="h-4 w-4" /> Add Team Member
        </h2>
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Email address"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 min-w-[200px]"
          />
          <Input
            placeholder="Temporary password"
            type="password"
            value={invitePassword}
            onChange={(e) => setInvitePassword(e.target.value)}
            className="w-48"
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
            disabled={!inviteEmail || !invitePassword || inviteMutation.isPending}
          >
            {inviteMutation.isPending ? "Inviting..." : "Invite"}
          </Button>
        </div>
      </div>

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
