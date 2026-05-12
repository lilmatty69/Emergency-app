import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert,
  ActivityIndicator, Modal, Animated, Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCall, statusColor, statusLabel, formatRel } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

export default function FirewatchLive() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState("0:00");
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const pollRef = useRef<any>(null);

  // Pulsing live indicator
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
    ])).start();
  }, []);

  const load = useCallback(async () => {
    try { const d = await apiCall(`/alerts/${alertId}/responses`); setData(d); }
    catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }, [alertId]);

  useEffect(() => {
    load(); pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [load]);

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
    try { await apiCall(`/alerts/${alertId}/mark-safe`, { method: "POST", body: { user_id: userId } }); load(); }
    catch (e: any) { Alert.alert("Failed", e.message); }
  };
  const remind = async () => {
    try {
      const r = await apiCall(`/alerts/${alertId}/remind`, { method: "POST" });
      Alert.alert("Reminder sent", `${r.reminded} people reminded.`);
    } catch (e: any) { Alert.alert("Failed", e.message); }
  };
  const confirmEnd = async () => {
    setEnding(true);
    try {
      await apiCall(`/alerts/${alertId}/end`, { method: "POST" });
      setShowEndConfirm(false);
      router.replace({ pathname: "/firewatch-report", params: { alertId } });
    } catch (e: any) { Alert.alert("Failed", e.message); }
    finally { setEnding(false); }
  };

  if (loading || !data) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={C.needs} /></SafeAreaView>;
  }

  const { summary, members, alert: a } = data;
  const isDrill = a.mode === "drill";
  const pct = summary.total ? Math.round(((summary.safe + summary.not_at_location) / summary.total) * 100) : 0;
  const groups: Record<string, any[]> = { needs_help: [], not_responded: [], not_at_location: [], safe: [], manually_marked_safe: [] };
  members.forEach((m: any) => { (groups[m.status] = groups[m.status] || []).push(m); });
  const stillUnsafe = (summary?.not_responded || 0) + (summary?.needs_help || 0);
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });

  return (
    <View style={{ flex: 1, backgroundColor: isDrill ? "#0B1020" : "#3A0707" }}>
      <LinearGradient
        colors={isDrill ? ["#0B1020", "#1F2547"] : ["#6B0F0F", "#B91C1C", "#7A0F0F"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      />

      {/* END confirmation modal */}
      <Modal transparent animationType="fade" visible={showEndConfirm} onRequestClose={() => setShowEndConfirm(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={[styles.modalIcon, { backgroundColor: stillUnsafe > 0 ? "#FEF2F2" : "#ECFDF5" }]}>
              <Ionicons name={stillUnsafe > 0 ? "warning" : "checkmark-circle"} size={28} color={stillUnsafe > 0 ? C.needs : C.safe} />
            </View>
            <Text style={styles.modalTitle}>End alert?</Text>
            <Text style={styles.modalText}>
              {stillUnsafe > 0
                ? `${stillUnsafe} people are still not confirmed safe. End anyway?`
                : "Everyone is accounted for. Ready to wrap up?"}
            </Text>
            <View style={styles.modalRow}>
              <ModalStat n={summary.safe} l="Safe" c={C.safe} />
              <ModalStat n={summary.needs_help} l="Need help" c={C.needs} />
              <ModalStat n={summary.not_responded} l="Not confirmed" c={C.pending} />
            </View>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                testID="cancel-end"
                style={[styles.modalBtn, { backgroundColor: C.surfaceMuted }]}
                onPress={() => setShowEndConfirm(false)} disabled={ending}
              >
                <Text style={[styles.modalBtnText, { color: C.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="confirm-end" style={[styles.modalBtn, { overflow: "hidden" }]} onPress={confirmEnd} disabled={ending}>
                <LinearGradient colors={["#DC2626", "#EF4444"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                {ending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.modalBtnText}>End alert</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.topBar}>
          <TouchableOpacity testID="back-btn" onPress={() => router.replace("/firewatch")} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={{ flex: 1, marginLeft: 8 }}>
            <View style={styles.modeRow}>
              <View style={styles.liveDotWrap}>
                <Animated.View style={[styles.liveDotPulse, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
                <View style={styles.liveDot} />
              </View>
              <Text style={styles.modeLabel}>
                {isDrill ? "DRILL · " : "LIVE EMERGENCY · "}{a.type.toUpperCase().replace("_", " ")}
              </Text>
            </View>
            <Text style={styles.elapsed} testID="elapsed">{elapsed}</Text>
          </View>

          <TouchableOpacity testID="end-alert-btn" style={styles.endBtn} onPress={() => setShowEndConfirm(true)}>
            <Text style={styles.endBtnText}>END</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <View style={styles.summaryGrid}>
            <SummaryCard label="Safe" value={summary.safe} color={C.safe} icon="checkmark-circle" testID="sum-safe" />
            <SummaryCard label="Needs help" value={summary.needs_help} color={C.needs} icon="alert-circle" testID="sum-help" />
            <SummaryCard label="Not confirmed" value={summary.not_responded} color={C.pending} icon="time" testID="sum-pending" />
            <SummaryCard label="Not at location" value={summary.not_at_location} color={C.away} icon="airplane" testID="sum-away" />
          </View>

          <View style={styles.progressCard}>
            <View style={styles.progressRow}>
              <Text style={styles.progressText}>{summary.safe + summary.not_at_location} / {summary.total} accounted for</Text>
              <Text style={[styles.progressPct, { color: pct >= 80 ? C.safe : pct >= 50 ? C.pending : C.needs }]}>{pct}%</Text>
            </View>
            <View style={styles.progressBar}>
              <LinearGradient
                colors={pct >= 80 ? ["#16A34A", "#22C55E"] : pct >= 50 ? ["#EA580C", "#F97316"] : ["#DC2626", "#EF4444"]}
                style={[styles.progressFill, { width: `${pct}%` }]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              />
            </View>
          </View>

          <TouchableOpacity testID="remind-btn" style={styles.remindBtn} onPress={remind} activeOpacity={0.9}>
            <Ionicons name="notifications" size={18} color={C.accent} />
            <Text style={styles.remindText}>Send reminder to non-responders</Text>
            <Ionicons name="arrow-forward" size={16} color={C.accent} />
          </TouchableOpacity>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
            {(["needs_help", "not_responded", "not_at_location", "safe", "manually_marked_safe"] as const).map((g) =>
              groups[g] && groups[g].length > 0 ? (
                <View key={g}>
                  <View style={styles.groupHead}>
                    <View style={[styles.groupDot, { backgroundColor: statusColor(g) }]} />
                    <Text style={[styles.groupTitle, { color: statusColor(g) }]}>
                      {statusLabel(g).toUpperCase()}
                    </Text>
                    <Text style={styles.groupCount}>· {groups[g].length}</Text>
                  </View>
                  {groups[g].map((m: any) => (
                    <View key={m.user_id} style={styles.memberRow} testID={`member-${m.user_id}`}>
                      <View style={[styles.avatar, { backgroundColor: statusColor(g) + "22" }]}>
                        <Text style={[styles.avatarText, { color: statusColor(g) }]}>{m.name?.[0] || "?"}</Text>
                      </View>
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
                            <TouchableOpacity onPress={() => Linking.openURL(`tel:${m.phone}`)} testID={`call-${m.user_id}`} style={styles.actionBtn}>
                              <Ionicons name="call" size={18} color={C.away} />
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity onPress={() => markSafe(m.user_id)} testID={`mark-safe-${m.user_id}`} style={[styles.actionBtn, { backgroundColor: "#ECFDF5" }]}>
                            <Ionicons name="checkmark" size={18} color={C.safe} />
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
    </View>
  );
}

function SummaryCard({ label, value, color, icon, testID }: any) {
  return (
    <View style={styles.sumCard} testID={testID}>
      <View style={[styles.sumIcon, { backgroundColor: color + "1A" }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={[styles.sumNum, { color }]}>{value}</Text>
      <Text style={styles.sumLabel}>{label}</Text>
    </View>
  );
}
function ModalStat({ n, l, c }: any) {
  return (
    <View style={styles.modalStatCol}>
      <Text style={[styles.modalStatNum, { color: c }]}>{n}</Text>
      <Text style={styles.modalStatLabel}>{l}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },

  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center" },
  modeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDotWrap: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  liveDotPulse: { position: "absolute", width: 14, height: 14, borderRadius: 7, backgroundColor: "#FFFFFF" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#FFFFFF" },
  modeLabel: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, opacity: 0.92 },
  elapsed: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginTop: 2, fontVariant: ["tabular-nums"] },
  endBtn: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  endBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },

  body: { flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, marginTop: 6 },

  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  sumCard: {
    flexGrow: 1, flexBasis: "47%", padding: 14, borderRadius: RADIUS.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, ...(SHADOW.sm as any),
  },
  sumIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  sumNum: { fontSize: 28, fontWeight: "900", marginTop: 8, letterSpacing: -0.5 },
  sumLabel: { fontSize: 11, color: C.textMuted, marginTop: 1, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: "700" },

  progressCard: { padding: 14, backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.border, marginTop: 14 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressText: { fontSize: 13, fontWeight: "700", color: C.text },
  progressPct: { fontSize: 16, fontWeight: "900" },
  progressBar: { height: 10, backgroundColor: C.surfaceMuted, borderRadius: 999, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 999 },

  remindBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 14, height: 50, backgroundColor: C.accentSoft, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: "#DFE2FF",
  },
  remindText: { flex: 1, fontSize: 13, fontWeight: "700", color: C.accent, textAlign: "center" },

  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18, marginBottom: 10 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  groupCount: { fontSize: 11, color: C.textMuted, fontWeight: "700" },

  memberRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, backgroundColor: C.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontWeight: "800" },
  memberName: { fontSize: 14, fontWeight: "700", color: C.text },
  memberMeta: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, alignItems: "center" },
  actionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.awaySoft, alignItems: "center", justifyContent: "center" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: "#FFFFFF", borderRadius: 24, padding: 24, ...(SHADOW.lg as any) },
  modalIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  modalTitle: { ...TYPE.h2, color: C.text },
  modalText: { ...TYPE.body, marginTop: 6 },
  modalRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 20, padding: 14, backgroundColor: C.surfaceMuted, borderRadius: RADIUS.md },
  modalStatCol: { alignItems: "center" },
  modalStatNum: { fontSize: 24, fontWeight: "900" },
  modalStatLabel: { fontSize: 10, color: C.textMuted, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: "700" },
  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  modalBtn: { flex: 1, height: 52, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  modalBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
