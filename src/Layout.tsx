import {
  Activity,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronRight,
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
  Calculator,
  Home,
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
    { id: "yardage", label: "Yardage calculator", icon: Calculator },
    { id: "barndominium-calculator", label: "Barndominium calculator", icon: Home },
    { id: "financials", label: "Financials", icon: BriefcaseBusiness },
    { id: "suppliers", label: "Suppliers", icon: UsersRound },
    { id: "spending", label: "Project spending", icon: BriefcaseBusiness },
    { id: "potential", label: "Potential jobs", icon: Search },
    { id: "pay-requests", label: "Invoices / pay requests", icon: ClipboardCheck },
    { id: "users", label: "User management", icon: UsersRound },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "schedule", label: "Schedule", icon: CalendarDays },
    { id: "contracts", label: "Contracts", icon: FileSignature },
    { id: "interests", label: "Interest inbox", icon: UsersRound },
    { id: "settings", label: "Admin settings", icon: Settings },
    { id: "audit", label: "Audit log", icon: ShieldCheck },
  ],
  project_manager: [
    { id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "projects", label: "Projects & jobs", icon: FolderKanban }, { id: "yardage", label: "Yardage calculator", icon: Calculator }, { id: "barndominium-calculator", label: "Barndominium calculator", icon: Home }, { id: "financials", label: "Financials", icon: BriefcaseBusiness }, { id: "suppliers", label: "Suppliers", icon: UsersRound }, { id: "potential", label: "Potential jobs", icon: Search }, { id: "pay-requests", label: "Invoices / pay requests", icon: ClipboardCheck }, { id: "users", label: "User management", icon: UsersRound }, { id: "notifications", label: "Notifications", icon: Bell }, { id: "schedule", label: "Schedule", icon: CalendarDays }, { id: "contracts", label: "Contracts", icon: FileSignature }, { id: "interests", label: "Interest inbox", icon: UsersRound }, { id: "settings", label: "Admin settings", icon: Settings }, { id: "audit", label: "Audit log", icon: ShieldCheck },
  ],
  client: [
    { id: "overview", label: "My project", icon: FolderKanban },
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
  project_manager: "Project manager",
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
  const currentLabel = nav.find((item) => item.id === view)?.label || view;
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
        <div className="workspace-card">
          <span className="workspace-icon"><Building2 size={17} /></span>
          <span><strong>Bullshark Contracting</strong><small>{roleLabels[role]} workspace</small></span>
          <i aria-hidden="true" />
        </div>
        <div className="nav-label">WORKSPACE</div>
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
          <div className="topbar-location"><span>Workspace</span><ChevronRight size={14} /><strong>{currentLabel}</strong></div>
          <div className="topbar-actions"><span className="topbar-status"><i aria-hidden="true" /> Team workspace</span><button className="button button-small" onClick={onSignOut}>Sign out</button><span className="topbar-avatar" aria-label={viewerName}>{initials}</span></div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
