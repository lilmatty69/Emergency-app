import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall, formatRel } from "../src/api";

export default function FirewatchDashboard() {
  const router = useRouter();
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const t = await apiCall("/teams/my");
      setTeams(t);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-btn">
          <Ionicons name="arrow-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Firewatch</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text style={styles.greet}>My Teams</Text>
        <Text style={styles.greetSub}>Teams under your accountability.</Text>

        {loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}

        {teams.map((t) => (
          <View key={t.id} style={styles.teamCard} testID={`team-card-${t.id}`}>
            <View style={styles.teamHead}>
              <Text style={styles.teamName}>{t.name}</Text>
              {t.active_alert_id ? (
                <View style={[styles.statusPill, { backgroundColor: COLORS.needsHelp }]}>
                  <View style={styles.dotWhite} />
                  <Text style={styles.statusPillText}>ALERT ACTIVE</Text>
                </View>
              ) : (
                <View style={[styles.statusPill, { backgroundColor: COLORS.safe }]}>
                  <Text style={styles.statusPillText}>NORMAL</Text>
                </View>
              )}
            </View>
            <View style={styles.teamMeta}>
              <View style={styles.metaItem}><Ionicons name="people-outline" size={16} color={COLORS.textSecondary} /><Text style={styles.metaText}>{t.member_count} people</Text></View>
              <View style={styles.metaItem}><Ionicons name="location-outline" size={16} color={COLORS.textSecondary} /><Text style={styles.metaText}>{t.assembly_point_name || "—"}</Text></View>
              <View style={styles.metaItem}><Ionicons name="time-outline" size={16} color={COLORS.textSecondary} /><Text style={styles.metaText}>Drill: {formatRel(t.last_drill_at)}</Text></View>
            </View>

            {t.active_alert_id ? (
              <TouchableOpacity
                testID={`open-live-${t.id}`}
                style={[styles.bigBtn, { backgroundColor: COLORS.needsHelp }]}
                onPress={() => router.push({ pathname: "/firewatch-live", params: { alertId: t.active_alert_id } })}
              >
                <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
                <Text style={styles.bigBtnText}>OPEN LIVE DASHBOARD</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.btnRow}>
                <TouchableOpacity
                  testID={`start-emergency-${t.id}`}
                  style={[styles.bigBtn, { backgroundColor: COLORS.needsHelp, flex: 1 }]}
                  onPress={() => router.push({ pathname: "/firewatch-alert", params: { teamId: t.id, mode: "emergency" } })}
                >
                  <Ionicons name="warning" size={20} color="#FFFFFF" />
                  <Text style={styles.bigBtnText}>START EMERGENCY</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`start-drill-${t.id}`}
                  style={[styles.bigBtn, { backgroundColor: COLORS.primary, flex: 1 }]}
                  onPress={() => router.push({ pathname: "/firewatch-alert", params: { teamId: t.id, mode: "drill" } })}
                >
                  <Ionicons name="play-circle" size={20} color="#FFFFFF" />
                  <Text style={styles.bigBtnText}>START DRILL</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}

        {!loading && teams.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyTitle}>No teams yet</Text>
            <Text style={styles.emptySub}>An admin must assign you as Firewatch to a team.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.textPrimary },
  scroll: { padding: 20, paddingBottom: 40 },
  greet: { fontSize: 26, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: -0.4 },
  greetSub: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4, marginBottom: 20 },
  teamCard: { padding: 18, backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.border, marginBottom: 14 },
  teamHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  teamName: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusPillText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  dotWhite: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" },
  teamMeta: { gap: 6, marginBottom: 14 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { fontSize: 13, color: COLORS.textSecondary },
  btnRow: { flexDirection: "row", gap: 10 },
  bigBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 56, borderRadius: 14, paddingHorizontal: 14 },
  bigBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  empty: { alignItems: "center", marginTop: 60, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: COLORS.textPrimary },
  emptySub: { fontSize: 13, color: COLORS.textSecondary, textAlign: "center", paddingHorizontal: 40 },
});
