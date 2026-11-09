import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "@/types";
import {
  lockOutboxWorker,
  unlockOutboxWorker,
  waitForInitialOutboxLoad,
  flushOutbox,
  beginSessionCoordinationLock,
  releaseSessionCoordinationLock,
} from "@/lib/offline/queue";
import { listOutbox } from "@/lib/offline/db";
import { handleSessionTransition, safeClearKvCoordinated } from "@/lib/api";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => Promise<void>;
  /** Returns true if logout succeeded, false if blocked by pending outbox items. */
  logout: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // بيانات جلسة تالفة قد تكون مخزّنة كنص "undefined"/"null" أو JSON غير صالح: نعاملها كجلسة منتهية بدل انهيار الـ render بالكامل (نفس حماية getCurrentAuthUser في queue.ts). لا نكتب على التخزين.
  const [token, setToken] = useState<string | null>(() => {
    const raw = localStorage.getItem("efms_token");
    return raw && raw !== "undefined" && raw !== "null" ? raw : null;
  });
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem("efms_user");
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });

  const login = async (newToken: string, newUser: User): Promise<void> => {
    // قفل المعالجة مؤقتاً أثناء التبديل
    lockOutboxWorker();

    try {
      await safeClearKvCoordinated();
      localStorage.setItem("efms_token", newToken);
      localStorage.setItem("efms_user", JSON.stringify(newUser));
      setToken(newToken);
      setUser(newUser);
    } finally {
      // فتح المعالجة للمستخدم الجديد وتفعيل المزامنة لعملياته الخاصة فقط
      unlockOutboxWorker();
      void flushOutbox();
    }
  };

  const logout = async (): Promise<boolean> => {
    // 1. تفعيل القفل الذري المشترك: منع عمليات queueWrite الجديدة وانتظار العمليات الجارية
    await beginSessionCoordinationLock();

    try {
      // 2. قراءة موثوقة وغير متزامنة من IndexedDB بعد التأكد من اكتمال كافة عمليات الكتابة
      await waitForInitialOutboxLoad();
      const authoritativeItems = await listOutbox();

      if (authoritativeItems.length > 0) {
        // فك القفل بأمان لاستمرار عمل المستخدم وإظهار التنبيه
        releaseSessionCoordinationLock();
        return false;
      }

      // 3. مسح الجلسة وتنسيق الكاش تحت نفس حماية القفل
      await handleSessionTransition("logout");
      setToken(null);
      setUser(null);
      return true;
    } catch (err) {
      console.error("Logout check failed safely:", err);
      // في حال الفشل في قراءة IndexedDB نمنع تسجيل الخروج ونفك القفل بأمان حفاظاً على البيانات
      releaseSessionCoordinationLock();
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
