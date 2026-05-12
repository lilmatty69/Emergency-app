import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall, statusColor, statusLabel } from "../src/api";

export default function FirewatchReport() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    apiCall(`/alerts/${alertId}/report`).then(setData).catch(console.warn);
  }, [alertId]);

  if (!data) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={COLORS.primary} /></SafeAreaView>;
  }

  const { alert: a, summary, response_list, organization, teams } = data;
  const duration = a.ended_at
    ? Math.round((new Date(a.ended_at).getTime() - new Date(a.started_at).getTime()) / 1000)
    : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/firewatch")} testID="back-btn">
          <Ionicons name="arrow-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.banner}>
          <Ionicons name="document-text" size={28} color={COLORS.primary} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.bannerTitle}>
              {a.mode === "drill" ? "Drill report" : "Emergency report"}
            </Text>
            <Text style={styles.bannerSub}>{a.type.replace("_", " ")} · {organization?.name}</Text>
          </View>
        </View>

        <Section title="Summary">
          <Row label="Team(s)" value={teams.map((t: any) => t.name).join(", ")} />
          <Row label="Started by" value={a.started_by_name} />
          <Row label="Started at" value={new Date(a.started_at).toLocaleString()} />
          <Row label="Ended at" value={a.ended_at ? new Date(a.ended_at).toLocaleString() : "—"} />
          <Row label="Duration" value={`${Math.floor(duration / 60)}m ${duration % 60}s`} />
          <Row label="Total people" value={String(summary.total)} />
          <Row label="Safe" value={String(summary.safe)} color={COLORS.safe} />
          <Row label="Needs help" value={String(summary.needs_help)} color={COLORS.needsHelp} />
          <Row label="Not confirmed safe" value={String(summary.not_responded)} color={COLORS.pending} />
          <Row label="Not at location" value={String(summary.not_at_location)} color={COLORS.notAtLocation} />
          <Row label="Avg response time" value={summary.avg_response_seconds != null ? `${summary.avg_response_seconds}s` : "—"} />
        </Section>

        <Section title="Response list">
          {response_list.map((r: any, i: number) => (
            <View key={i} style={styles.respRow}>
              <View style={[styles.dot, { backgroundColor: statusColor(r.status) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.respName}>{r.name}</Text>
                <Text style={styles.respMeta}>
                  {statusLabel(r.status)}
                  {r.safe_location ? ` · ${r.safe_location}` : ""}
                  {r.note ? ` · ${r.note}` : ""}
                </Text>
              </View>
            </View>
          ))}
        </Section>

        <TouchableOpacity testID="done-btn" style={styles.doneBtn} onPress={() => router.replace("/firewatch")}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: any) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Row({ label, value, color }: any) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, color && { color, fontWeight: "800" }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.textPrimary },
  scroll: { padding: 20, paddingBottom: 40 },
  banner: { flexDirection: "row", alignItems: "center", padding: 18, backgroundColor: COLORS.surface, borderRadius: 16, marginBottom: 18 },
  bannerTitle: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  bannerSub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2, textTransform: "capitalize" },
  section: { marginBottom: 22, padding: 18, backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  sectionTitle: { fontSize: 12, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { fontSize: 13, color: COLORS.textSecondary },
  rowValue: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary, maxWidth: "60%", textAlign: "right" },
  respRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  respName: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary },
  respMeta: { fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  doneBtn: { height: 56, backgroundColor: COLORS.primary, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  doneBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
});
