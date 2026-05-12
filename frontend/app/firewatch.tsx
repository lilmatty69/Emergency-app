import { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCall, formatRel } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

export default function FirewatchDashboard() {
  const router = useRouter();
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const t = await apiCall("/teams/my"); setTeams(t); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Firewatch</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={styles.kicker}>COMMAND CENTER</Text>
        <Text style={styles.title}>My Teams</Text>
        <Text style={styles.sub}>Teams under your accountability.</Text>

        {loading ? <ActivityIndicator style={{ marginTop: 28 }} color={C.accent} /> : null}

        {teams.map((t) => (
          <View key={t.id} style={styles.teamCard} testID={`team-card-${t.id}`}>
            {t.active_alert_id ? (
              <View style={styles.alertStripe}>
                <LinearGradient colors={["#DC2626", "#EF4444"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
                <View style={styles.liveDot} />
                <Text style={styles.alertStripeText}>ALERT ACTIVE · LIVE</Text>
              </View>
            ) : null}

            <View style={styles.teamHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.teamName}>{t.name}</Text>
                <Text style={styles.teamSub}>{t.member_count} people accountable</Text>
              </View>
              {!t.active_alert_id ? (
                <View style={styles.statusPill}>
                  <View style={styles.greenDot} />
                  <Text style={styles.statusPillText}>NORMAL</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.teamMeta}>
              <Meta icon="location-outline" text={t.assembly_point_name || "—"} />
              <Meta icon="time-outline" text={`Drill: ${formatRel(t.last_drill_at)}`} />
            </View>

            {t.active_alert_id ? (
              <TouchableOpacity
                testID={`open-live-${t.id}`}
                style={styles.openLiveBtn}
                onPress={() => router.push({ pathname: "/firewatch-live", params: { alertId: t.active_alert_id } })}
                activeOpacity={0.9}
              >
                <LinearGradient colors={["#DC2626", "#EF4444"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                <Ionicons name="pulse" size={20} color="#FFFFFF" />
                <Text style={styles.openLiveText}>OPEN LIVE DASHBOARD</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <View style={styles.btnRow}>
                <TouchableOpacity
                  testID={`start-emergency-${t.id}`}
                  style={[styles.actionBtn, { overflow: "hidden" }]}
                  onPress={() => router.push({ pathname: "/firewatch-alert", params: { teamId: t.id, mode: "emergency" } })}
                  activeOpacity={0.92}
                >
                  <LinearGradient colors={["#DC2626", "#EF4444"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                  <Ionicons name="warning" size={20} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>EMERGENCY</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`start-drill-${t.id}`}
                  style={[styles.actionBtn, { overflow: "hidden" }]}
                  onPress={() => router.push({ pathname: "/firewatch-alert", params: { teamId: t.id, mode: "drill" } })}
                  activeOpacity={0.92}
                >
                  <LinearGradient colors={["#0B1020", "#1F2547"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                  <Ionicons name="play-circle" size={20} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>DRILL</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}

        {!loading && teams.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyTitle}>No teams yet</Text>
            <Text style={styles.emptySub}>An admin must assign you as Firewatch to a team.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Meta({ icon, text }: any) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon} size={15} color={C.textMuted} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  headerTitle: { ...TYPE.h3, fontSize: 16 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  scroll: { padding: 20, paddingBottom: 40 },
  kicker: { ...TYPE.label, color: C.accent, marginTop: 4 },
  title: { ...TYPE.h1, marginTop: 6 },
  sub: { ...TYPE.body, marginTop: 6, marginBottom: 22 },

  teamCard: {
    backgroundColor: C.surface, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
    overflow: "hidden", ...(SHADOW.md as any),
  },
  alertStripe: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  alertStripeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  teamHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, paddingBottom: 8 },
  teamName: { ...TYPE.h3, fontSize: 19, color: C.text },
  teamSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#A7F3D0" },
  statusPillText: { color: "#065F46", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.safe },

  teamMeta: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingHorizontal: 18, paddingBottom: 14 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 12, color: C.textSub, fontWeight: "500" },

  btnRow: { flexDirection: "row", gap: 10, padding: 14, paddingTop: 0 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 54, borderRadius: RADIUS.md,
  },
  actionBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", letterSpacing: 1 },

  openLiveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 58, margin: 14, marginTop: 0, borderRadius: RADIUS.md, overflow: "hidden",
    ...(SHADOW.md as any),
  },
  openLiveText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800", letterSpacing: 1 },

  empty: { alignItems: "center", marginTop: 60, gap: 10 },
  emptyTitle: { ...TYPE.h3 },
  emptySub: { ...TYPE.body, textAlign: "center", paddingHorizontal: 40 },
});
