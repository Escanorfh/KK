import { useCallback, useEffect, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { Loader2, Plus, Save, Trash2, Pencil, Search, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiError, getApiFieldErrors } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  type ManagedUser,
  type AssignableRole,
} from "@/services/users";
import { projectOptions } from "@/services/projects";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500";
const labelCls = "block text-[13px] font-semibold text-slate-600 mb-1.5";

const ROLE_LABELS: Record<AssignableRole, string> = {
  USER: "مستخدم",
  MANAGER: "مدير متابعة",
  ADMIN: "مدير",
};

interface FormState {
  name: string;
  email: string;
  password: string;
  role: AssignableRole;
  projectIds: number[];
}

const emptyForm: FormState = { name: "", email: "", password: "", role: "USER", projectIds: [] };

const thCls = "px-3 py-2.5 text-right text-xs font-bold text-slate-600 bg-slate-50 border-b border-slate-200 whitespace-nowrap";
const tdCls = "px-3 py-2.5 text-[13px] text-slate-700 border-b border-slate-100";

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [options, setOptions] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await listUsers(q.trim() || undefined));
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    projectOptions()
      .then(setOptions)
      .catch((err) => toast.error(getApiError(err)));
  }, []);

  const err = (k: string) => fieldErrors[k]?.[0];

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFieldErrors({});
  };

  const startEdit = (u: ManagedUser) => {
    setEditingId(u.id);
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role === "ROOT" ? "ADMIN" : u.role,
      projectIds: (u.projects ?? []).map((p) => p.project.id),
    });
    setFieldErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleProject = (id: number) => {
    setForm((f) => ({
      ...f,
      projectIds: f.projectIds.includes(id)
        ? f.projectIds.filter((x) => x !== id)
        : [...f.projectIds, id],
    }));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFieldErrors({});
    try {
      const projectIds =
        form.role === "ADMIN" ? [] : form.projectIds;
      if (editingId) {
        await updateUser(editingId, {
          name: form.name,
          email: form.email,
          role: form.role,
          projectIds,
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success("تم تحديث المستخدم");
      } else {
        await createUser({ ...form, projectIds });
        toast.success("تم إنشاء المستخدم");
      }
      resetForm();
      load();
    } catch (err2) {
      setFieldErrors(getApiFieldErrors(err2));
      toast.error(getApiError(err2));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: ManagedUser) => {
    try {
      await updateUser(u.id, { active: !u.active });
      toast.success(u.active ? "تم تعطيل المستخدم" : "تم تفعيل المستخدم");
      load();
    } catch (err2) {
      toast.error(getApiError(err2));
    }
  };

  const handleDelete = async (u: ManagedUser) => {
    if (!window.confirm(`حذف المستخدم "${u.name}" (${u.email})؟ لن يُحذف سجلاته.`)) return;
    try {
      await deleteUser(u.id);
      toast.success("تم حذف المستخدم");
      load();
    } catch (err2) {
      toast.error(getApiError(err2));
    }
  };

  const userProjects = (u: ManagedUser) => (u.projects ?? []).map((p) => p.project.name);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-800">المستخدمين</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            إنشاء وتعديل المستخدمين والأدوار — المستخدم بمشروع واحد، ومدير المتابعة بأكثر من مشروع
          </p>
        </div>
        <div className="relative w-64">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم أو البريد..."
            className={cn(inputCls, "pr-9")}
          />
        </div>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} className="text-primary-700" />
          <h2 className="text-sm font-bold text-slate-700">
            {editingId ? `تعديل المستخدم #${editingId}` : "إنشاء مستخدم جديد"}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="mr-auto text-xs font-semibold text-slate-500 hover:text-red-600"
            >
              إلغاء التعديل
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className={labelCls}>
              الاسم <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="الاسم بالكامل"
              className={cn(inputCls, err("name") && "border-red-400")}
            />
            {err("name") && <p className="text-xs text-red-600 mt-1">{err("name")}</p>}
          </div>
          <div>
            <label className={labelCls}>
              البريد <span className="text-red-500">*</span>
            </label>
            <input
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="user@site.com"
              className={cn(inputCls, err("email") && "border-red-400")}
            />
            {err("email") && <p className="text-xs text-red-600 mt-1">{err("email")}</p>}
          </div>
          <div>
            <label className={labelCls}>
              كلمة السر {editingId ? "(اتركها فاضية للإبقاء)" : <span className="text-red-500">*</span>}
            </label>
            <input
              dir="ltr"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="4 أحرف على الأقل"
              className={cn(inputCls, err("password") && "border-red-400")}
            />
            {err("password") && <p className="text-xs text-red-600 mt-1">{err("password")}</p>}
          </div>
          <div>
            <label className={labelCls}>الدور</label>
            <select
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  role: e.target.value as AssignableRole,
                  projectIds: e.target.value === "ADMIN" ? [] : f.projectIds,
                }))
              }
              className={inputCls}
            >
              <option value="USER">مستخدم</option>
              <option value="MANAGER">مدير متابعة</option>
              <option value="ADMIN">مدير</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg py-2.5 transition-colors"
          >
            {saving ? (
              <Loader2 size={15} className="animate-spin" />
            ) : editingId ? (
              <Save size={15} />
            ) : (
              <Plus size={15} />
            )}
            {editingId ? "حفظ التعديلات" : "إنشاء المستخدم"}
          </button>
        </div>

        {form.role === "USER" && (
          <div className="mt-3">
            <label className={labelCls}>
              المشروع <span className="text-red-500">*</span>
            </label>
            <select
              value={form.projectIds[0] ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  projectIds: e.target.value ? [Number(e.target.value)] : [],
                }))
              }
              className={cn(inputCls, "max-w-md", err("projectIds") && "border-red-400")}
            >
              <option value="">— اختر مشروعًا واحدًا —</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {err("projectIds") && <p className="text-xs text-red-600 mt-1">{err("projectIds")}</p>}
          </div>
        )}

        {form.role === "MANAGER" && (
          <div className="mt-3">
            <label className={labelCls}>
              المشاريع التي يتابعها <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {options.map((p) => {
                const checked = form.projectIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProject(p.id)}
                    className={cn(
                      "text-[12px] font-semibold rounded-full px-3 py-1.5 border transition-colors",
                      checked
                        ? "bg-primary-700 border-primary-700 text-white"
                        : "bg-white border-slate-300 text-slate-600 hover:border-primary-500"
                    )}
                  >
                    {p.name}
                  </button>
                );
              })}
              {options.length === 0 && (
                <span className="text-xs text-slate-400">لا توجد مشاريع بعد</span>
              )}
            </div>
            {err("projectIds") && <p className="text-xs text-red-600 mt-1">{err("projectIds")}</p>}
          </div>
        )}

        {form.role === "ADMIN" && (
          <p className="mt-3 text-xs text-slate-500">
            المدير يملك صلاحية كل المشاريع — بدون تقييد.
          </p>
        )}
      </form>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className={thCls}>#</th>
                <th className={thCls}>الاسم</th>
                <th className={thCls}>البريد</th>
                <th className={thCls}>الدور</th>
                <th className={thCls}>المشاريع</th>
                <th className={thCls}>الحالة</th>
                <th className={cn(thCls, "text-center")}>سجلات DAY</th>
                <th className={cn(thCls, "text-center")}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">
                    <Loader2 size={17} className="animate-spin inline ml-2" /> جاري التحميل...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">
                    لا يوجد مستخدمون
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isMe = u.id === me?.id;
                  const names = userProjects(u);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className={cn(tdCls, "font-mono text-xs text-slate-400")}>{u.id}</td>
                      <td className={cn(tdCls, "font-semibold")}>
                        {u.name}
                        {isMe && (
                          <span className="mr-2 text-[10px] font-bold text-primary-700 bg-primary-100 rounded-full px-2 py-0.5">
                            أنت
                          </span>
                        )}
                      </td>
                      <td className={cn(tdCls, "font-mono text-xs")} dir="ltr">
                        {u.email}
                      </td>
                      <td className={tdCls}>
                        <span
                          className={cn(
                            "text-[11px] font-bold rounded-full px-2.5 py-1",
                            u.role === "ROOT"
                              ? "bg-red-100 text-red-700"
                              : u.role === "ADMIN"
                                ? "bg-primary-100 text-primary-800"
                                : u.role === "MANAGER"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {u.role === "ROOT" ? "جذر" : ROLE_LABELS[u.role]}
                        </span>
                      </td>
                      <td className={tdCls}>
                        {u.role === "ROOT" || u.role === "ADMIN" ? (
                          <span className="text-[11px] font-semibold text-emerald-700">
                            كل المشاريع
                          </span>
                        ) : names.length ? (
                          <div className="flex flex-wrap gap-1">
                            {names.map((n) => (
                              <span
                                key={n}
                                className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-slate-100 text-slate-600"
                              >
                                {n}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-red-500 font-semibold">
                            بدون مشاريع
                          </span>
                        )}
                      </td>
                      <td className={tdCls}>
                        {u.active ? (
                          <span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-emerald-100 text-emerald-700">
                            نشط
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-red-100 text-red-700">
                            معطّل
                          </span>
                        )}
                      </td>
                      <td className={cn(tdCls, "text-center font-mono text-xs")}>
                        {u._count?.dailyLogs ?? 0}
                      </td>
                      <td className={cn(tdCls, "text-center")}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => startEdit(u)}
                            title="تعديل"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-100 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleActive(u)}
                            disabled={isMe}
                            title={isMe ? "لا يمكنك تعطيل حسابك" : u.active ? "تعطيل" : "تفعيل"}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors",
                              isMe
                                ? "text-slate-200 cursor-not-allowed"
                                : u.active
                                  ? "text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                                  : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                            )}
                          >
                            {u.active ? <UserX size={14} /> : <UserCheck size={14} />}
                          </button>
                          <button
                            onClick={() => handleDelete(u)}
                            disabled={isMe}
                            title={isMe ? "لا يمكنك حذف حسابك" : "حذف"}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors",
                              isMe
                                ? "text-slate-200 cursor-not-allowed"
                                : "text-slate-400 hover:text-red-600 hover:bg-red-50"
                            )}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
          عدد المستخدمين: <b>{users.length}</b> — الدور <b>مستخدم</b> بمشروع واحد، و
          <b> مدير المتابعة</b> بأكثر من مشروع، و<b>مدير</b> و<b>جذر</b> على كل المشاريع
        </div>
      </div>
    </div>
  );
}
