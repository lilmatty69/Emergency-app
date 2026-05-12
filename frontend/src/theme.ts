// SafeCount design system — Stripe/Linear modern SaaS + Govt-grade trust
// Plus dramatic emergency theme.
import { Platform } from "react-native";

export const C = {
  // Background system
  bg: "#FAFAFB",          // page bg, slight cool off-white
  bgWarm: "#FCFCFD",      // alt
  surface: "#FFFFFF",     // cards
  surfaceMuted: "#F4F5F7",
  border: "#EEF0F3",      // hairline
  borderStrong: "#E2E5EB",

  // Text
  text: "#0B1020",        // near-black with blue undertone
  textSub: "#5B6478",
  textMuted: "#8A93A6",

  // Brand accent (Linear/Stripe-ish electric indigo)
  accent: "#5B5BF5",
  accentSoft: "#EEF0FF",
  accentDeep: "#3F3FCC",

  // Status (user spec hexes preserved)
  safe: "#16A34A",
  safeSoft: "#ECFDF5",
  needs: "#DC2626",
  needsSoft: "#FEF2F2",
  pending: "#EA580C",
  pendingSoft: "#FFF7ED",
  away: "#2563EB",
  awaySoft: "#EFF6FF",
  inactive: "#9CA3AF",

  // Emergency theme (dramatic)
  emerBg: "#7A0F0F",        // deep blood
  emerMid: "#B91C1C",
  emerHi: "#EF4444",
  emerGlow: "rgba(239, 68, 68, 0.45)",
  emerInk: "#FEE2E2",
};

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 };

export const SHADOW = {
  // Stripe-style soft elevation
  sm: Platform.select({
    ios: { shadowColor: "#0B1020", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 },
    android: { elevation: 1 },
    default: { boxShadow: "0 2px 8px rgba(11,16,32,0.05)" } as any,
  }),
  md: Platform.select({
    ios: { shadowColor: "#0B1020", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 18 },
    android: { elevation: 3 },
    default: { boxShadow: "0 6px 18px rgba(11,16,32,0.08)" } as any,
  }),
  lg: Platform.select({
    ios: { shadowColor: "#0B1020", shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.12, shadowRadius: 34 },
    android: { elevation: 8 },
    default: { boxShadow: "0 14px 34px rgba(11,16,32,0.12)" } as any,
  }),
  emergency: Platform.select({
    ios: { shadowColor: "#B91C1C", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 30 },
    android: { elevation: 10 },
    default: { boxShadow: "0 12px 36px rgba(185,28,28,0.4)" } as any,
  }),
};

export const TYPE = {
  display: { fontSize: 40, fontWeight: "900" as const, letterSpacing: -1.2, lineHeight: 44 },
  h1: { fontSize: 30, fontWeight: "800" as const, letterSpacing: -0.6, lineHeight: 36 },
  h2: { fontSize: 22, fontWeight: "800" as const, letterSpacing: -0.4, lineHeight: 28 },
  h3: { fontSize: 17, fontWeight: "700" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "400" as const, color: C.textSub, lineHeight: 22 },
  label: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 1.4, textTransform: "uppercase" as const, color: C.textMuted },
};

// Status-keyed helpers
export function statusColor(s: string) {
  switch (s) {
    case "safe": case "manually_marked_safe": return C.safe;
    case "needs_help": return C.needs;
    case "not_at_location": return C.away;
    case "not_responded": return C.pending;
    default: return C.inactive;
  }
}
export function statusSoft(s: string) {
  switch (s) {
    case "safe": case "manually_marked_safe": return C.safeSoft;
    case "needs_help": return C.needsSoft;
    case "not_at_location": return C.awaySoft;
    case "not_responded": return C.pendingSoft;
    default: return C.surfaceMuted;
  }
}
export function statusLabel(s: string) {
  switch (s) {
    case "safe": return "Safe";
    case "manually_marked_safe": return "Marked safe";
    case "needs_help": return "Needs help";
    case "not_at_location": return "Not at location";
    case "not_responded": return "Not confirmed safe";
    default: return s;
  }
}
