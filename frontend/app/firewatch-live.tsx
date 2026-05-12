import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall, statusColor, statusLabel, formatRel } from "../src/api";

export default function FirewatchLive() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState("0:00");
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiCall(`/alerts/${alertId}/responses`);
      setData(d);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  // elapsed timer
  useEffect(() => {
    if (!data?.alert?.started_at) return;
    const id = setInterval(() => {
      const sec = Math.max(0, Math.floor((Date.now() - new Date(data.alert.started_at).getTime()) / 1000));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`);
    }, 500);
    return () => clearInterval(id);
  }, [data?.alert?.started_at]);

  const markSafe = async (userId: string) => {
    try {
      await apiCall(`/alerts/${alertId}/mark-safe`, { method: "POST", body: { user_id: userId } });
      load();
    } catch (e: any) { Alert.alert("Failed", e.message); }
  };

  const remind = async () => {
    try {
      const r = await apiCall(`/alerts/${alertId}/remind`, { method: "POST" });
      Alert.alert("Reminder sent", `${r.reminded} people reminded.`);
    } catch (e: any) { Alert.alert("Failed", e.message); }
  };

  const endAlert = async () => {
    const summary = data?.summary;
    const stillUnsafe = summary ? summary.not_responded + summary.needs_help : 0;
    Alert.alert(
      "End alert?",
      stillUnsafe > 0
        ? `${stillUnsafe} people are still not confirmed safe. End anyway?`
        : "Are you sure you want to end this alert?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End alert",
          style: "destructive",
          onPress: async () => {
            try {
              await apiCall(`/alerts/${alertId}/end`, { method: "POST" });
              router.replace({ pathname: "/firewatch-report", params: { alertId } });
            } catch (e: any) { Alert.alert("Failed", e.message); }
          },
        },
      ],
    );
  };

  if (loading || !data) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={COLORS.emergencyBg} /></SafeAreaView>;
  }

  const { summary, members, alert: a } = data;
  const isDrill = a.mode === "drill";
  const pct = summary.total ? Math.round(((summary.safe + summary.not_at_location) / summary.total) * 100) : 0;
  const groups: Record<string, any[]> = { needs_help: [], not_responded: [], not_at_location: [], safe: [], manually_marked_safe: [] };
  members.forEach((m: any) => { (groups[m.status] = groups[m.status] || []).push(m); });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDrill ? COLORS.primary : COLORS.emergencyBg }]} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity testID="back-btn" onPress={() => router.replace("/firewatch")} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.modeLabel}>{isDrill ? "DRILL · " : "EMERGENCY · "}{a.type.toUpperCase().replace("_", " ")}</Text>
          <Text style={styles.elapsed} testID="elapsed">{elapsed}</Text>
        </View>
        <TouchableOpacity testID="end-alert-btn" style={styles.endBtn} onPress={endAlert}>
          <Text style={styles.endBtnText}>END</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        <View style={styles.summaryGrid}>
          <SummaryCard label="Safe" value={summary.safe} color={COLORS.safe} testID="sum-safe" />
          <SummaryCard label="Needs help" value={summary.needs_help} color={COLORS.needsHelp} testID="sum-help" />
          <SummaryCard label="Not confirmed" value={summary.not_responded} color={COLORS.pending} testID="sum-pending" />
          <SummaryCard label="Away" value={summary.not_at_location} color={COLORS.notAtLocation} testID="sum-away" />
        </View>

        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{summary.safe + summary.not_at_location} / {summary.total} confirmed</Text>
          <Text style={styles.progressPct}>{pct}%</Text>
        </View>
        <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>

        <TouchableOpacity testID="remind-btn" style={styles.remindBtn} onPress={remind}>
          <Ionicons name="notifications" size={18} color={COLORS.textPrimary} />
          <Text style={styles.remindText}>Send reminder to non-responders</Text>
        </TouchableOpacity>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {(["needs_help", "not_responded", "not_at_location", "safe", "manually_marked_safe"] as const).map((g) =>
            groups[g] && groups[g].length > 0 ? (
              <View key={g}>
                <Text style={[styles.groupTitle, { color: statusColor(g) }]}>{statusLabel(g).toUpperCase()} · {groups[g].length}</Text>
                {groups[g].map((m: any) => (
                  <View key={m.user_id} style={styles.memberRow} testID={`member-${m.user_id}`}>
                    <View style={[styles.dot, { backgroundColor: statusColor(g) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{m.name}</Text>
                      <Text style={styles.memberMeta}>
                        {m.response?.response_time ? formatRel(m.response.response_time) : "No response"}
                        {m.response?.safe_location ? ` · ${m.response.safe_location}` : ""}
                        {m.response?.note ? ` · ${m.response.note}` : ""}
                      </Text>
                    </View>
                    {g !== "safe" && g !== "manually_marked_safe" ? (
                      <View style={styles.actions}>
                        {m.phone ? (
                          <TouchableOpacity onPress={() => Linking.openURL(`tel:${m.phone}`)} testID={`call-${m.user_id}`}>
                            <Ionicons name="call" size={22} color={COLORS.notAtLocation} />
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity onPress={() => markSafe(m.user_id)} testID={`mark-safe-${m.user_id}`}>
                          <Ionicons name="checkmark-circle" size={26} color={COLORS.safe} />
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, color, testID }: any) {
  return (
    <View style={[styles.sumCard, { borderColor: color }]} testID={testID}>
      <Text style={[styles.sumNum, { color }]}>{value}</Text>
      <Text style={styles.sumLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center" },
  modeLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, opacity: 0.85 },
  elapsed: { color: "#FFFFFF", fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginTop: 2 },
  endBtn: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 999 },
  endBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  body: { flex: 1, backgroundColor: COLORS.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  sumCard: { flexGrow: 1, flexBasis: "47%", padding: 14, borderRadius: 14, borderWidth: 2, backgroundColor: "#FFFFFF" },
  sumNum: { fontSize: 28, fontWeight: "800" },
  sumLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "700" },
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  progressText: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary },
  progressPct: { fontSize: 13, fontWeight: "800", color: COLORS.safe },
  progressBar: { height: 8, backgroundColor: COLORS.border, borderRadius: 999, marginTop: 6, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: COLORS.safe },
  remindBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, height: 46, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  remindText: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary },
  groupTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2, marginTop: 18, marginBottom: 8 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  memberName: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
  memberMeta: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  actions: { flexDirection: "row", gap: 12, alignItems: "center" },
});
