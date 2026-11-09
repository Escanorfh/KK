import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { LogIn, Loader2 } from "lucide-react";
import { loginRequest } from "@/services/auth";
import { getApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ConnectionStatus from "@/components/ConnectionStatus";

export default function LoginPage() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/dashboard";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await loginRequest(name.trim(), password);
      await login(data.token, data.user);
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-700 text-white text-2xl font-extrabold mb-3">
            EF
          </div>
          <h1 className="text-2xl font-extrabold text-white">EFMS</h1>
          <p className="text-slate-400 text-sm mt-1">نظام متابعة المعدات والصيانة — قاصد خير</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">الاسم</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="اكتب اسمك كما هو مسجّل"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">كلمة السر</label>
            <input
              type="password"
              required
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            تسجيل الدخول
          </button>
        </form>

        <div className="flex justify-center mt-4">
          <ConnectionStatus />
        </div>
      </div>
    </div>
  );
}
