import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall, formatRel } from "../src/api";

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<any>({ teams: [], members: [], aps: [], org: null, history: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [org, teams, members, aps, history] = await Promise.all([
        apiCall("/org"),
        apiCall("/teams"),
        apiCall("/members"),
        apiCall("/assembly-points"),
        apiCall("/alerts/history/list"),
      ]);
      setData({ org, teams, members, aps, history });
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeCount = data.history.filter((a: any) => a.status === "active").length;
  const lastDrill = data.history.find((a: any) => a.mode === "drill");

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-btn">
          <Ionicons name="arrow-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <View style={styles.orgBlock}>
          <Text style={styles.smLabel}>Organization</Text>
          <Text style={styles.orgName} testID="org-name">{data.org?.name || "—"}</Text>
          <Text style={styles.orgMeta}>
            {data.org?.type ? data.org.type.charAt(0).toUpperCase() + data.org.type.slice(1) : ""}
            {data.org?.address ? ` · ${data.org.address}` : ""}
          </Text>
        </View>

        <View style={styles.statGrid}>
          <View style={styles.stat}><Text style={styles.statNum} testID="stat-teams">{data.teams.length}</Text><Text style={styles.statLabel}>Teams</Text></View>
          <View style={styles.stat}><Text style={styles.statNum} testID="stat-people">{data.members.length}</Text><Text style={styles.statLabel}>People</Text></View>
          <View style={styles.stat}><Text style={[styles.statNum, activeCount > 0 && { color: COLORS.needsHelp }]} testID="stat-active">{activeCount}</Text><Text style={styles.statLabel}>Active</Text></View>
          <View style={styles.stat}><Text style={styles.statNum}>{data.aps.length}</Text><Text style={styles.statLabel}>Points</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Teams</Text>
        {loading && data.teams.length === 0 ? (
          <ActivityIndicator />
        ) : (
          data.teams.map((t: any) => (
            <View key={t.id} style={styles.row} testID={`team-row-${t.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t.name}</Text>
                <Text style={styles.rowMeta}>Firewatch: {t.firewatch_name || "—"} · {t.member_count} people</Text>
                <Text style={styles.rowMeta}>Assembly: {t.assembly_point_name || "—"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Assembly points</Text>
        {data.aps.map((a: any) => (
          <View key={a.id} style={styles.row}>
            <Ionicons name="location-outline" size={22} color={COLORS.notAtLocation} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.rowTitle}>{a.name}</Text>
              {a.description ? <Text style={styles.rowMeta}>{a.description}</Text> : null}
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Emergency history</Text>
        {data.history.length === 0 ? (
          <Text style={styles.empty}>No alerts yet.</Text>
        ) : (
          data.history.map((a: any) => (
            <View key={a.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{a.mode === "drill" ? "Drill" : "Emergency"} · {a.type.replace("_", " ")}</Text>
                <Text style={styles.rowMeta}>
                  Started {formatRel(a.started_at)} by {a.started_by_name}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: a.status === "active" ? COLORS.needsHelp : COLORS.inactive }]}>
                <Text style={styles.badgeText}>{a.status}</Text>
              </View>
            </View>
          ))
        )}
        {lastDrill ? <Text style={styles.foot}>Last drill: {formatRel(lastDrill.started_at)}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.textPrimary },
  scroll: { padding: 20, paddingBottom: 40 },
  orgBlock: { marginBottom: 20 },
  smLabel: { fontSize: 11, fontWeight: "700", color: COLORS.textSecondary, letterSpacing: 1.2, textTransform: "uppercase" },
  orgName: { fontSize: 24, fontWeight: "800", color: COLORS.textPrimary, marginTop: 4 },
  orgMeta: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  statGrid: { flexDirection: "row", gap: 10, marginBottom: 24 },
  stat: { flex: 1, padding: 14, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, alignItems: "center" },
  statNum: { fontSize: 26, fontWeight: "800", color: COLORS.textPrimary },
  statLabel: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "600" },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary, marginTop: 18, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.8 },
  row: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: COLORS.textPrimary },
  rowMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  empty: { fontSize: 13, color: COLORS.textSecondary, fontStyle: "italic" },
  foot: { fontSize: 12, color: COLORS.textSecondary, marginTop: 12, textAlign: "center" },
});
