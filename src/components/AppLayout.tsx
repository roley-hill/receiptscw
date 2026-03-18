import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { usePendingCounts } from "@/hooks/usePendingCounts";
import UploadProgressFloat from "@/components/UploadProgressFloat";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Upload,
  ClipboardCheck,
  FileText,
  Layers,
  FolderOpen,
  Search,
  AlertTriangle,
  Copy,
  Menu,
  Users,
  Building2,
} from "lucide-react";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, countKey: null },
  { title: "Upload", url: "/upload", icon: Upload, countKey: null },
  { title: "Review", url: "/review", icon: ClipboardCheck, countKey: "review" as const },
  { title: "Entry & Recording", url: "/entry", icon: FileText, countKey: "entry" as const },
  { title: "Receivables Report", url: "/receivables", icon: FileText, countKey: null },
  { title: "Deposit Batches", url: "/batches", icon: Layers, countKey: "batches" as const },
  { title: "Browse Files", url: "/browse", icon: FolderOpen, countKey: null },
  { title: "Exceptions", url: "/exceptions", icon: AlertTriangle, countKey: "exceptions" as const },
  { title: "Duplicates", url: "/duplicates", icon: Copy, countKey: "duplicates" as const },
  { title: "Team", url: "/team", icon: Users, countKey: null },
  { title: "DD Extract", url: "/dd/upload", icon: Building2, countKey: null },
  { title: "DD File Sorter", url: "/dd/sort", icon: FolderOpen, countKey: null },
  { title: "Ownership Entities", url: "/ownership", icon: Building2, countKey: null },
];

interface NavPermissions {
  pipeline: boolean;
  reports_batches: boolean;
  tools: boolean;
  acquisitions: boolean;
  admin: boolean;
}

function CountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
      {count}
    </span>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const { data: counts } = usePendingCounts();

  const { data: navPerms } = useQuery<NavPermissions>({
    queryKey: ["nav-permissions", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("nav_permissions")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data?.nav_permissions as unknown as NavPermissions) ?? {
        pipeline: true,
        reports_batches: true,
        tools: true,
        acquisitions: true,
        admin: true,
      };
    },
  });

  const perms: NavPermissions = navPerms ?? {
    pipeline: true,
    reports_batches: true,
    tools: true,
    acquisitions: true,
    admin: true,
  };

  const renderNavItem = (item: typeof navItems[number]) => (
    <SidebarMenuItem key={item.title}>
      <SidebarMenuButton asChild>
        <NavLink
          to={item.url}
          end={item.url === "/"}
          className="vault-sidebar-item-inactive"
          activeClassName="vault-sidebar-item-active"
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span>{item.title}</span>
          {item.countKey && counts && <CountBadge count={counts[item.countKey]} />}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar className="border-r border-sidebar-border">
          <SidebarContent>
            <div className="px-4 py-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
                  <span className="text-xs font-black text-sidebar-primary-foreground tracking-tighter">CW</span>
                </div>
                <div>
                  <h1 className="text-sm font-bold text-sidebar-accent-foreground tracking-tight">Countywide</h1>
                  <p className="text-[10px] text-sidebar-foreground/60 uppercase tracking-widest">Receipt Hub</p>
                </div>
              </div>
            </div>

            {perms.pipeline && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest px-4">
                  Pipeline
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.slice(0, 4).map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {perms.reports_batches && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest px-4">
                  Reports & Batches
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.slice(4, 6).map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {perms.tools && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest px-4">
                  Tools
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.slice(6, 9).map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {perms.acquisitions && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest px-4">
                  Acquisitions
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.slice(10, 12).map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {perms.admin && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest px-4">
                  Admin
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.slice(9, 10).map(renderNavItem)}
                    {navItems.slice(12, 13).map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
        </Sidebar>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-3">
              <SidebarTrigger>
                <Menu className="h-5 w-5" />
              </SidebarTrigger>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search receipts, tenants, properties..."
                  className="h-9 w-80 rounded-md border border-input bg-background pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => signOut()}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign out
              </button>
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-xs font-semibold text-primary-foreground">
                  {user?.email?.substring(0, 2).toUpperCase() || "??"}
                </span>
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 bg-background">
            {children}
          </main>
        </div>
      </div>
      <UploadProgressFloat />
    </SidebarProvider>
  );
}
