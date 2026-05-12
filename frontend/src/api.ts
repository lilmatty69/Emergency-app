// SafeCount shared API client. Design tokens moved to theme.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { C, statusColor as sc, statusLabel as sl } from "./theme";

export const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL + "/api";

// Re-export for back-compat with existing screens
export const COLORS = {
  bg: C.bg,
  surface: C.surface,
  textPrimary: C.text,
  textSecondary: C.textSub,
  border: C.border,
  safe: C.safe,
  needsHelp: C.needs,
  pending: C.pending,
  notAtLocation: C.away,
  inactive: C.inactive,
  emergencyBg: C.needs,
  emergencyHighlight: C.needsSoft,
  warning: C.pending,
  primary: C.text,
};

export async function apiCall(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {}
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false) {
    const token = await AsyncStorage.getItem("token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data;
}

export async function saveAuth(token: string, user: any) {
  await AsyncStorage.setItem("token", token);
  await AsyncStorage.setItem("user", JSON.stringify(user));
}
export async function loadAuth() {
  const [token, userStr] = await Promise.all([
    AsyncStorage.getItem("token"),
    AsyncStorage.getItem("user"),
  ]);
  return { token, user: userStr ? JSON.parse(userStr) : null };
}
export async function clearAuth() {
  await AsyncStorage.multiRemove(["token", "user"]);
}

export const statusColor = sc;
export const statusLabel = sl;

export function formatRel(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
