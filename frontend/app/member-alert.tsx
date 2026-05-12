import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall } from "../src/api";

type Stage = "choose" | "safe-where" | "safe-done" | "help-detail" | "help-done" | "away-done";
const HELP_REASONS = ["I am injured", "I am trapped", "I cannot leave", "I need assistance", "Other"];

export default function MemberAlert() {
  const { alertId: paramId } = useLocalSearchParams<{ alertId?: string }>();
  const router = useRouter();
  const [alertData, setAlertData] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [stage, setStage] = useState<Stage>("choose");
  const [aps, setAps] = useState<any[]>([]);
  const [selectedAp, setSelectedAp] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [extraNote, setExtraNote] = useState<string>("");
  const [shareLocation, setShareLocation] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const active = paramId ? await apiCall(`/alerts/${paramId}`) : await apiCall("/alerts/active");
        if (!active) {
          router.replace("/member");
          return;
        }
        setAlertData(active);
        const t = await apiCall("/teams/mine-member");
        setTeam(t);
        const points = await apiCall("/assembly-points");
        setAps(points);
      } catch (e) {
        console.warn(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const submit = async (status: "safe" | "needs_help" | "not_at_location") => {
    if (!alertData) return;
    setSubmitting(true);
    try {
      await apiCall(`/alerts/${alertData.id}/respond`, {
        method: "POST",
        body: {
          status,
          safe_location: status === "safe" ? selectedAp : null,
          note: status === "needs_help" ? [reason, extraNote].filter(Boolean).join(" — ") : null,
          location_shared: status === "needs_help" ? shareLocation : false,
        },
      });
      if (status === "safe") setStage("safe-done");
      else if (status === "needs_help") setStage("help-done");
      else setStage("away-done");
    } catch (e: any) {
      Alert.alert("Failed", e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !alertData) {
    return <SafeAreaView style={[styles.container, styles.center]}><ActivityIndicator color="#FFFFFF" /></SafeAreaView>;
  }

  const isDrill = alertData.mode === "drill";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: COLORS.emergencyBg }]} edges={["top", "bottom"]}>
      <View style={styles.banner}>
        {isDrill ? <Text style={styles.drillBadge}>DRILL · PRACTICE</Text> : null}
        <Text style={styles.bannerTitle}>EMERGENCY ALERT</Text>
        <Text style={styles.bannerType}>
          {alertData.type.replace("_", " ").toUpperCase()}
          {team?.team?.name ? ` · ${team.team.name}` : ""}
        </Text>
        <Text style={styles.bannerMsg}>{alertData.message}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.sheet}>
        <View style={styles.card}>
          {stage === "choose" && (
            <>
              <Text style={styles.q}>Please confirm your safety.</Text>
              <TouchableOpacity
                testID="btn-safe"
                style={[styles.bigBtn, { backgroundColor: COLORS.safe }]}
                onPress={() => setStage("safe-where")}
              >
                <Ionicons name="checkmark-circle" size={32} color="#FFFFFF" />
                <Text style={styles.bigBtnText}>I AM SAFE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="btn-help"
                style={[styles.bigBtn, { backgroundColor: COLORS.needsHelp }]}
                onPress={() => setStage("help-detail")}
              >
                <Ionicons name="alert-circle" size={32} color="#FFFFFF" />
                <Text style={styles.bigBtnText}>I NEED HELP</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="btn-away"
                style={[styles.bigBtn, { backgroundColor: COLORS.notAtLocation, height: 70 }]}
                onPress={() => submit("not_at_location")}
                disabled={submitting}
              >
                <Ionicons name="airplane-outline" size={24} color="#FFFFFF" />
                <Text style={[styles.bigBtnText, { fontSize: 17 }]}>I AM NOT AT THIS LOCATION TODAY</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === "safe-where" && (
            <>
              <Text style={styles.q}>Where are you safe?</Text>
              {aps.map((ap) => (
                <TouchableOpacity
                  key={ap.id}
                  testID={`ap-${ap.id}`}
                  style={[styles.choice, selectedAp === ap.name && styles.choiceActive]}
                  onPress={() => setSelectedAp(ap.name)}
                >
                  <Ionicons name="location" size={20} color={selectedAp === ap.name ? "#FFFFFF" : COLORS.textPrimary} />
                  <Text style={[styles.choiceText, selectedAp === ap.name && { color: "#FFFFFF" }]}>{ap.name}</Text>
                </TouchableOpacity>
              ))}
              {["Outside building", "Other safe place"].map((opt) => (
                <TouchableOpacity
                  key={opt}
                  testID={`ap-${opt}`}
                  style={[styles.choice, selectedAp === opt && styles.choiceActive]}
                  onPress={() => setSelectedAp(opt)}
                >
                  <Ionicons name="walk" size={20} color={selectedAp === opt ? "#FFFFFF" : COLORS.textPrimary} />
                  <Text style={[styles.choiceText, selectedAp === opt && { color: "#FFFFFF" }]}>{opt}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                testID="confirm-safe"
                style={[styles.confirmBtn, !selectedAp && { opacity: 0.4 }]}
                onPress={() => selectedAp && submit("safe")}
                disabled={!selectedAp || submitting}
              >
                <Text style={styles.confirmBtnText}>{submitting ? "Sending..." : "Confirm I am safe"}</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === "safe-done" && (
            <DoneCard
              icon="checkmark-circle"
              color={COLORS.safe}
              title="You are marked safe."
              subtitle={`Please stay at ${selectedAp || "your safe location"} until further instructions.`}
              onUpdate={() => setStage("choose")}
            />
          )}

          {stage === "help-detail" && (
            <>
              <Text style={styles.q}>What is happening?</Text>
              {HELP_REASONS.map((r) => (
                <TouchableOpacity
                  key={r}
                  testID={`reason-${r}`}
                  style={[styles.choice, reason === r && styles.choiceActiveHelp]}
                  onPress={() => setReason(r)}
                >
                  <Text style={[styles.choiceText, reason === r && { color: "#FFFFFF" }]}>{r}</Text>
                </TouchableOpacity>
              ))}
              <TextInput
                testID="help-note"
                style={styles.note}
                placeholder="Optional note (e.g. floor, room number)"
                placeholderTextColor="#94A3B8"
                value={extraNote}
                onChangeText={setExtraNote}
              />
              <TouchableOpacity
                testID="toggle-share"
                style={[styles.toggleRow, shareLocation && styles.toggleRowOn]}
                onPress={() => setShareLocation((v) => !v)}
              >
                <Ionicons name={shareLocation ? "checkbox" : "square-outline"} size={22} color={shareLocation ? "#FFFFFF" : COLORS.textPrimary} />
                <Text style={[styles.toggleText, shareLocation && { color: "#FFFFFF" }]}>Share my location during this emergency</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="confirm-help"
                style={[styles.confirmBtn, { backgroundColor: COLORS.needsHelp }]}
                onPress={() => submit("needs_help")}
                disabled={submitting}
              >
                <Text style={styles.confirmBtnText}>{submitting ? "Sending..." : "Send help request"}</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === "help-done" && (
            <DoneCard
              icon="alert-circle"
              color={COLORS.needsHelp}
              title="Help request sent."
              subtitle="Your Firewatch has been notified and is coordinating help."
              onUpdate={() => setStage("choose")}
            />
          )}

          {stage === "away-done" && (
            <DoneCard
              icon="airplane"
              color={COLORS.notAtLocation}
              title="Marked as not at this location."
              subtitle="Thanks — you've been excluded from this headcount."
              onUpdate={() => setStage("choose")}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DoneCard({ icon, color, title, subtitle, onUpdate }: any) {
  return (
    <View style={styles.done}>
      <Ionicons name={icon} size={56} color={color} />
      <Text style={styles.doneTitle}>{title}</Text>
      <Text style={styles.doneSub}>{subtitle}</Text>
      <TouchableOpacity testID="update-response" style={styles.updateBtn} onPress={onUpdate}>
        <Text style={styles.updateText}>Update my response</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  banner: { padding: 24, paddingTop: 16 },
  drillBadge: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, opacity: 0.85, marginBottom: 6 },
  bannerTitle: { color: "#FFFFFF", fontSize: 34, fontWeight: "900", letterSpacing: -0.5 },
  bannerType: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", marginTop: 6, opacity: 0.95, letterSpacing: 0.5 },
  bannerMsg: { color: "#FFFFFF", fontSize: 14, marginTop: 8, opacity: 0.9, lineHeight: 19 },
  sheet: { flexGrow: 1, padding: 16, paddingBottom: 30 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 22 },
  q: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 18, textAlign: "center" },
  bigBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, height: 84, borderRadius: 20, marginBottom: 14 },
  bigBtnText: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: "#FFFFFF", borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, marginBottom: 8 },
  choiceActive: { backgroundColor: COLORS.safe, borderColor: COLORS.safe },
  choiceActiveHelp: { backgroundColor: COLORS.needsHelp, borderColor: COLORS.needsHelp },
  choiceText: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary },
  confirmBtn: { height: 60, backgroundColor: COLORS.safe, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 14 },
  confirmBtnText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  note: { minHeight: 60, padding: 14, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, marginTop: 4, fontSize: 14, color: COLORS.textPrimary, textAlignVertical: "top" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, marginTop: 10 },
  toggleRowOn: { backgroundColor: COLORS.notAtLocation, borderColor: COLORS.notAtLocation },
  toggleText: { flex: 1, fontSize: 13, fontWeight: "600", color: COLORS.textPrimary },
  done: { alignItems: "center", paddingVertical: 20 },
  doneTitle: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary, marginTop: 14, textAlign: "center" },
  doneSub: { fontSize: 14, color: COLORS.textSecondary, marginTop: 8, textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },
  updateBtn: { marginTop: 22, paddingHorizontal: 20, paddingVertical: 12, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12 },
  updateText: { fontSize: 14, fontWeight: "700", color: COLORS.textPrimary },
});
