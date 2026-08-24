import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  FileSignature,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Search,
  Settings,
  ShieldCheck,
  Bell,
  UsersRound,
  X,
} from "lucide-react";
import { useState, type PropsWithChildren } from "react";
import type { Role } from "./types";

export interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const navByRole: Record<Role, NavItem[]> = {
  admin: [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "projects", label: "Projects & jobs", icon: FolderKanban },
    { id: "potential", label: "Potential jobs", icon: Search },
    { id: "pay-requests", label: "Invoices / pay requests", icon: ClipboardCheck },
    { id: "users", label: "Users", icon: UsersRound },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "schedule", label: "Schedule", icon: CalendarDays },
    { id: "contracts", label: "Contracts", icon: FileSignature },
    { id: "interests", label: "Interest inbox", icon: UsersRound },
    { id: "settings", label: "Admin settings", icon: Settings },
    { id: "audit", label: "Audit log", icon: ShieldCheck },
  ],
  client: [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "projects", label: "My projects", icon: FolderKanban },
    { id: "schedule", label: "Job schedule", icon: CalendarDays },
    { id: "progress", label: "Progress", icon: Activity },
    { id: "documents", label: "Documents", icon: ClipboardCheck },
    { id: "messages", label: "Messages", icon: MessageSquareText },
    { id: "notifications", label: "Notifications", icon: Bell },
  ],
  subcontractor: [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "jobs", label: "My jobs", icon: BriefcaseBusiness },
    { id: "schedule", label: "Schedule", icon: CalendarDays },
    { id: "contracts", label: "Contracts", icon: FileSignature },
    { id: "potential", label: "Potential jobs", icon: Search },
    { id: "pay-requests", label: "Pay requests", icon: ClipboardCheck },
    { id: "messages", label: "Messages", icon: MessageSquareText },
    { id: "notifications", label: "Notifications", icon: Bell },
  ],
};

const roleLabels: Record<Role, string> = {
  admin: "Admin",
  client: "Client",
  subcontractor: "Subcontractor",
};

export function Layout({
  role,
  viewerName,
  view,
  onViewChange,
  onRoleChange,
  onSignOut = () => undefined,
  children,
}: PropsWithChildren<{
  role: Role;
  viewerName: string;
  view: string;
  onViewChange: (view: string) => void;
  onRoleChange: (role: Role) => void;
  onSignOut?: () => void;
}>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = navByRole[role];
  const initials = viewerName.split(" ").map((part) => part[0]).slice(0, 2).join("");
  const chooseView = (id: string) => {
    onViewChange(id);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">B</span>
          <span><strong>BULLSHARK</strong><small>CONNECTED</small></span>
          <button className="mobile-close" type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X /></button>
        </div>
        <div className="signed-in"><span>{role === "admin" ? "Signed in as" : "Viewing as"}</span><strong>{roleLabels[role]}</strong></div>
        <nav aria-label="Main navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={view === item.id ? "active" : ""} onClick={() => chooseView(item.id)}>
                <Icon size={18} /> <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-profile">
          <span className="avatar">{initials}</span>
          <span><strong>{viewerName}</strong><small>BullShark Contracting</small></span>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <main className="main-shell">
        <header className="topbar">
          <button type="button" className="menu-button" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu /></button>
          <div className="search-shell"><Search size={17} /><input aria-label="Search" placeholder="Search projects, jobs, people…" /></div>
          <button className="button button-small" onClick={onSignOut}>Sign out</button>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
