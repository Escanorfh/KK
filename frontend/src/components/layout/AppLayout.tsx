import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  CalendarDays,
  Table2,
  Wrench,
  ClipboardList,
  AlertTriangle,
  Droplets,
  FileCog,
  PackagePlus,
  HardHat,
  FolderKanban,
  Users,
  Database,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ConnectionStatus from "@/components/ConnectionStatus";
import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/types";

interface NavLink {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles?: Role[];
}

const sections: { title: string; links: NavLink[] }[] = [
  {
    title: "المتابعة",
    links: [
      { to: "/dashboard", label: "لوحة المتابعة", icon: LayoutDashboard },
      { to: "/day", label: "السراكي اليومية (DAY)", icon: CalendarDays },
      { to: "/data-day", label: "عرض السجلات (DATA DAY)", icon: Table2 },
      { to: "/work", label: "أعمال الصيانة (WORK)", icon: Wrench },
      { to: "/data-work", label: "عرض الصيانة (DATA WORK)", icon: ClipboardList },
    ],
  },
  {
    title: "المراقبة",
    links: [
      { to: "/faults", label: "جدول الأعطال", icon: AlertTriangle },
      { to: "/repair-orders", label: "طلبات الإصلاح", icon: FileCog },
      { to: "/need-requests", label: "طلبات الاحتياج", icon: PackagePlus },
      { to: "/oil-alerts", label: "تنبيهات الزيوت", icon: Droplets },
    ],
  },
  {
    title: "البيانات الأساسية",
    links: [
      { to: "/equipment", label: "سجل المعدات", icon: HardHat },
      { to: "/projects", label: "المشاريع والقطاعات", icon: FolderKanban },
    ],
  },
  {
    title: "الإدارة",
    links: [
      { to: "/tracking-modes", label: "أوضاع التتبع والفئات", icon: SlidersHorizontal, roles: ["ROOT", "ADMIN"] },
      { to: "/users", label: "المستخدمين", icon: Users, roles: ["ROOT", "ADMIN"] },
      { to: "/data-management", label: "إدارة البيانات", icon: Database, roles: ["ROOT"] },
    ],
  },
];

const ROLE_LABELS: Record<Role, string> = {
  ROOT: "جذر — صلاحيات كاملة",
  ADMIN: "مدير",
  MANAGER: "مدير متابعة",
  USER: "مستخدم",
};

function scopeLabel(user: { role: Role; projects?: { id: number; name: string }[] } | null) {
  if (!user) return "";
  if (user.role === "ROOT" || user.role === "ADMIN") return "كل المشاريع";
  const names = user.projects?.map((p) => p.name) ?? [];
  return names.length ? names.join("، ") : "بدون مشاريع";
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="w-64 bg-slate-900 text-slate-200 flex flex-col fixed inset-y-0 right-0 print:hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h1 className="text-lg font-extrabold text-white tracking-wide">EFMS</h1>
          <p className="text-[11px] text-slate-400 mt-0.5">متابعة المعدات والصيانة — قاصد خير</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {sections
            .map((section) => ({
              ...section,
              links: section.links.filter(
                (l) => !l.roles || (user && l.roles.includes(user.role))
              ),
            }))
            .filter((section) => section.links.length > 0)
            .map((section) => (
              <div key={section.title}>
                <div className="px-2 mb-1.5 text-[11px] font-semibold text-slate-500 uppercase">
                  {section.title}
                </div>
                <div className="space-y-1">
                  {section.links.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
                          isActive
                            ? "bg-primary-700 text-white font-semibold"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        )
                      }
                    >
                      <Icon size={16} className="shrink-0" />
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{user?.name}</div>
              <div className="text-[11px] text-slate-400">
                {user ? ROLE_LABELS[user.role] : ""}
              </div>
              <div className="text-[10px] text-slate-500 truncate" title={scopeLabel(user)}>
                {scopeLabel(user)}
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="تسجيل الخروج"
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 mr-64 flex flex-col min-h-screen print:mr-0">
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-3 sticky top-0 z-40 print:hidden">
          <div className="text-sm font-semibold text-slate-700">نظام متابعة المعدات والصيانة</div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500">
              {new Date().toLocaleDateString("ar-EG", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            <ConnectionStatus />
          </div>
        </header>
        <main className="flex-1 p-6 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
