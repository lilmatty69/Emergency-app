import { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCall } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

export default function MemberHome() {
  const router = useRouter();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const [team, active] = await Promise.all([apiCall("/teams/mine-member"), apiCall("/alerts/active")]);
      setInfo({ team, active });
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    load(); pollRef.current = setInterval(load, 5000);
    return () => clearInterval(pollRef.current);
  }, [load]));

  if (loading) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={C.accent} /></SafeAreaView>;
  }

  const team = info?.team?.team;
  const fw = info?.team?.firewatch_name;
  const ap = info?.team?.assembly_point;
  const org = info?.team?.organization;
  const active = info?.active && info.active.status === "active" ? info.active : null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Home</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {active ? (
          <TouchableOpacity
            testID="active-alert-banner"
            style={styles.alertBanner}
            onPress={() => router.push({ pathname: "/member-alert", params: { alertId: active.id } })}
            activeOpacity={0.9}
          >
            <LinearGradient colors={["#DC2626", "#EF4444"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
            <View style={styles.alertBannerIcon}><Ionicons name="warning" size={22} color="#FFFFFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertBannerTitle}>Active alert — tap to respond</Text>
              <Text style={styles.alertBannerSub}>
                {active.mode === "drill" ? "Drill" : "Emergency"} · {active.type.replace("_", " ")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <View style={styles.calmCard}>
            <View style={styles.calmDot}><View style={styles.calmDotInner} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.calmText}>All clear</Text>
              <Text style={styles.calmSub}>No active emergencies</Text>
            </View>
            <Ionicons name="shield-checkmark" size={20} color={C.safe} />
          </View>
        )}

        <View style={styles.bigCard}>
          <Row label="Organization" value={org?.name || "—"} icon="business-outline" testID="org-name" />
          <Divider />
          <Row label="Team" value={team?.name || "—"} icon="people-outline" testID="team-name" />
          <Divider />
          <Row label="Firewatch" value={fw || "—"} icon="shield-checkmark-outline" testID="firewatch-name" />
          <Divider />
          <Row label="Assembly point" value={ap?.name || "—"} icon="location-outline" sub={ap?.description} testID="assembly-name" />
        </View>

        <View style={styles.tipsCard}>
          <View style={styles.tipsHeader}>
            <Ionicons name="alert-circle-outline" size={18} color={C.accent} />
            <Text style={styles.tipsTitle}>Emergency instructions</Text>
          </View>
          <Tip n={1} t="Stay calm. Stop what you are doing." />
          <Tip n={2} t="Leave via the nearest safe exit. Do not use elevators." />
          <Tip n={3} t="Go directly to your assembly point." />
          <Tip n={4} t="Open SafeCount and mark yourself safe — or tap I need help." />
          <Tip n={5} t="Wait for your Firewatch to confirm everyone is accounted for." />
        </View>

        <View style={styles.privacy}>
          <Ionicons name="lock-closed" size={14} color={C.textMuted} />
          <Text style={styles.privacyText}>
            Location sharing is OFF in normal mode. Enabled only during an active emergency, with your consent.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, icon, sub, testID }: any) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={C.textSub} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} testID={testID}>{value}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}
function Divider() { return <View style={styles.divider} />; }
function Tip({ n, t }: any) {
  return (
    <View style={styles.tipRow}>
      <View style={styles.tipNum}><Text style={styles.tipNumText}>{n}</Text></View>
      <Text style={styles.tipText}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  headerTitle: { ...TYPE.h3, fontSize: 16 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20, paddingBottom: 40 },

  alertBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: RADIUS.lg, overflow: "hidden",
    ...(SHADOW.md as any),
  },
  alertBannerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center" },
  alertBannerTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  alertBannerSub: { color: "#FFFFFF", fontSize: 12, opacity: 0.9, marginTop: 2, textTransform: "capitalize" },

  calmCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, backgroundColor: C.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: C.border, ...(SHADOW.sm as any),
  },
  calmDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  calmDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.safe },
  calmText: { ...TYPE.h3, color: C.text, fontSize: 16 },
  calmSub: { fontSize: 12, color: C.textMuted, marginTop: 1 },

  bigCard: { padding: 8, backgroundColor: C.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.border, marginTop: 16, ...(SHADOW.sm as any) },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surfaceMuted, alignItems: "center", justifyContent: "center" },
  rowLabel: { ...TYPE.label, fontSize: 10 },
  rowValue: { ...TYPE.h3, marginTop: 2 },
  rowSub: { fontSize: 12, color: C.textMuted, marginTop: 4 },
  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },

  tipsCard: { marginTop: 16, padding: 20, backgroundColor: C.accentSoft, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: "#DFE2FF" },
  tipsHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  tipsTitle: { ...TYPE.label, color: C.accent, fontSize: 11 },
  tipRow: { flexDirection: "row", gap: 12, marginBottom: 10, alignItems: "flex-start" },
  tipNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  tipNumText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  tipText: { flex: 1, fontSize: 14, color: C.text, lineHeight: 20 },

  privacy: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 16, paddingHorizontal: 6 },
  privacyText: { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 17 },
});
