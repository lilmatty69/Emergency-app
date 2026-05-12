// SafeCount shared API client and design tokens
import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL + "/api";

export const COLORS = {
  bg: "#FFFFFF",
  surface: "#F8FAFC",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  border: "#E2E8F0",
  // Status
  safe: "#16A34A",
  needsHelp: "#DC2626",
  pending: "#EA580C",
  notAtLocation: "#2563EB",
  inactive: "#9CA3AF",
  // Emergency
  emergencyBg: "#DC2626",
  emergencyHighlight: "#FEF2F2",
  warning: "#EA580C",
  // Primary
  primary: "#0F172A",
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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(data?.detail || `HTTP ${res.status}`);
  }
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

export function statusColor(status: string): string {
  switch (status) {
    case "safe":
    case "manually_marked_safe":
      return COLORS.safe;
    case "needs_help":
      return COLORS.needsHelp;
    case "not_at_location":
      return COLORS.notAtLocation;
    case "not_responded":
      return COLORS.pending;
    default:
      return COLORS.inactive;
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "safe":
      return "Safe";
    case "manually_marked_safe":
      return "Marked safe";
    case "needs_help":
      return "Needs help";
    case "not_at_location":
      return "Not at location";
    case "not_responded":
      return "Not confirmed safe";
    default:
      return status;
  }
}

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
