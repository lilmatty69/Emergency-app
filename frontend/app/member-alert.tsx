import { useEffect, useState, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Animated, Easing,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCall } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

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

  // Dramatic pulse animation on banner
  const pulse = useRef(new Animated.Value(0)).current;
  const ringPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
    ])).start();
    Animated.loop(Animated.timing(ringPulse, { toValue: 1, duration: 1800, useNativeDriver: true, easing: Easing.out(Easing.ease) })).start();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const active = paramId ? await apiCall(`/alerts/${paramId}`) : await apiCall("/alerts/active");
        if (!active) { router.replace("/member"); return; }
        setAlertData(active);
        const t = await apiCall("/teams/mine-member"); setTeam(t);
        const points = await apiCall("/assembly-points"); setAps(points);
      } catch (e) { console.warn(e); }
      finally { setLoading(false); }
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
    } catch (e: any) { Alert.alert("Failed", e.message); }
    finally { setSubmitting(false); }
  };

  if (loading || !alertData) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: C.emerBg }]}>
        <ActivityIndicator color="#FFFFFF" />
      </SafeAreaView>
    );
  }

  const isDrill = alertData.mode === "drill";
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  const ringScale = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.35] });
  const ringOpacity = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View style={{ flex: 1, backgroundColor: "#3A0707" }}>
      {/* Dramatic gradient backdrop */}
      <LinearGradient
        colors={["#6B0F0F", "#B91C1C", "#7A0F0F"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      />
      {/* Glow blobs */}
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.banner}>
          <View style={styles.bannerTopRow}>
            <TouchableOpacity testID="back-btn" onPress={() => router.replace("/member")} style={styles.bannerBack}>
              <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
              <Text style={styles.bannerBackText}>Back</Text>
            </TouchableOpacity>
            {isDrill ? <View style={styles.drillBadge}><Text style={styles.drillBadgeText}>DRILL · PRACTICE</Text></View> : null}
          </View>

          {/* Pulsing siren */}
          <View style={styles.sirenWrap}>
            <Animated.View style={[styles.sirenPulse, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
            <Animated.View style={[styles.sirenRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
            <View style={styles.sirenCore}>
              <Ionicons name="warning" size={36} color="#FFFFFF" />
            </View>
          </View>

          <Text style={styles.bannerTitle}>EMERGENCY{"\n"}ALERT</Text>
          <View style={styles.alertChip}>
            <View style={styles.alertChipDot} />
            <Text style={styles.alertChipText}>
              {alertData.type.replace("_", " ").toUpperCase()}
              {team?.team?.name ? `  ·  ${team.team.name}` : ""}
            </Text>
          </View>
          <Text style={styles.bannerMsg}>{alertData.message}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.sheetWrap} showsVerticalScrollIndicator={false}>
          <View style={styles.sheet}>
            {stage === "choose" && (
              <>
                <Text style={styles.q}>Please confirm your safety</Text>
                <BigButton
                  testID="btn-safe" icon="checkmark-circle" label="I AM SAFE"
                  grad={["#16A34A", "#22C55E"]} onPress={() => setStage("safe-where")}
                />
                <BigButton
                  testID="btn-help" icon="alert-circle" label="I NEED HELP"
                  grad={["#DC2626", "#EF4444"]} onPress={() => setStage("help-detail")}
                />
                <BigButton
                  testID="btn-away" icon="airplane" label="NOT AT THIS LOCATION TODAY"
                  grad={["#2563EB", "#3B82F6"]} small onPress={() => submit("not_at_location")}
                />
              </>
            )}

            {stage === "safe-where" && (
              <>
                <Text style={styles.q}>Where are you safe?</Text>
                {aps.map((ap) => (
                  <Choice
                    key={ap.id}
                    testID={`ap-${ap.id}`}
                    icon="location"
                    label={ap.name}
                    active={selectedAp === ap.name}
                    color={C.safe}
                    onPress={() => setSelectedAp(ap.name)}
                  />
                ))}
                {["Outside building", "Other safe place"].map((opt) => (
                  <Choice
                    key={opt}
                    testID={`ap-${opt}`}
                    icon="walk"
                    label={opt}
                    active={selectedAp === opt}
                    color={C.safe}
                    onPress={() => setSelectedAp(opt)}
                  />
                ))}
                <TouchableOpacity
                  testID="confirm-safe"
                  style={[styles.confirmBtn, { backgroundColor: C.safe }, !selectedAp && { opacity: 0.35 }]}
                  onPress={() => selectedAp && submit("safe")}
                  disabled={!selectedAp || submitting}
                  activeOpacity={0.9}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                  <Text style={styles.confirmBtnText}>{submitting ? "Sending..." : "Confirm I am safe"}</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === "safe-done" && (
              <Done
                icon="checkmark-circle" color={C.safe} bg="#ECFDF5"
                title="You are marked safe"
                subtitle={`Please stay at ${selectedAp || "your safe location"} until further instructions.`}
                onUpdate={() => setStage("choose")}
              />
            )}

            {stage === "help-detail" && (
              <>
                <Text style={styles.q}>What is happening?</Text>
                {HELP_REASONS.map((r) => (
                  <Choice
                    key={r}
                    testID={`reason-${r}`}
                    icon="alert-circle"
                    label={r}
                    active={reason === r}
                    color={C.needs}
                    onPress={() => setReason(r)}
                  />
                ))}
                <TextInput
                  testID="help-note"
                  style={styles.note}
                  placeholder="Optional note (floor, room number)"
                  placeholderTextColor={C.textMuted}
                  value={extraNote}
                  onChangeText={setExtraNote}
                />
                <TouchableOpacity
                  testID="toggle-share"
                  style={[styles.toggleRow, shareLocation && { backgroundColor: C.away, borderColor: C.away }]}
                  onPress={() => setShareLocation((v) => !v)}
                  activeOpacity={0.85}
                >
                  <Ionicons name={shareLocation ? "checkbox" : "square-outline"} size={22} color={shareLocation ? "#FFFFFF" : C.text} />
                  <Text style={[styles.toggleText, shareLocation && { color: "#FFFFFF" }]}>Share my location during this emergency</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="confirm-help"
                  style={[styles.confirmBtn, { backgroundColor: C.needs }]}
                  onPress={() => submit("needs_help")}
                  disabled={submitting}
                  activeOpacity={0.9}
                >
                  <Ionicons name="send" size={18} color="#FFFFFF" />
                  <Text style={styles.confirmBtnText}>{submitting ? "Sending..." : "Send help request"}</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === "help-done" && (
              <Done
                icon="alert-circle" color={C.needs} bg="#FEF2F2"
                title="Help request sent"
                subtitle="Your Firewatch has been notified and is coordinating help."
                onUpdate={() => setStage("choose")}
              />
            )}

            {stage === "away-done" && (
              <Done
                icon="airplane" color={C.away} bg="#EFF6FF"
                title="Marked as not at this location"
                subtitle="Thanks — you've been excluded from this headcount."
                onUpdate={() => setStage("choose")}
              />
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function BigButton({ testID, icon, label, grad, onPress, small }: any) {
  return (
    <TouchableOpacity testID={testID} onPress={onPress} activeOpacity={0.92} style={[styles.bigBtn, small && { height: 72 }]}>
      <LinearGradient colors={grad} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <Ionicons name={icon} size={small ? 24 : 32} color="#FFFFFF" />
      <Text style={[styles.bigBtnText, small && { fontSize: 16 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Choice({ testID, icon, label, active, color, onPress }: any) {
  return (
    <TouchableOpacity testID={testID} style={[styles.choice, active && { backgroundColor: color, borderColor: color }]} onPress={onPress} activeOpacity={0.9}>
      <Ionicons name={icon} size={20} color={active ? "#FFFFFF" : C.text} />
      <Text style={[styles.choiceText, active && { color: "#FFFFFF" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Done({ icon, color, bg, title, subtitle, onUpdate }: any) {
  return (
    <View style={styles.done}>
      <View style={[styles.doneIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={48} color={color} />
      </View>
      <Text style={styles.doneTitle}>{title}</Text>
      <Text style={styles.doneSub}>{subtitle}</Text>
      <TouchableOpacity testID="update-response" style={styles.updateBtn} onPress={onUpdate}>
        <Ionicons name="refresh" size={16} color={C.text} />
        <Text style={styles.updateText}>Update my response</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  glowTop: { position: "absolute", top: -80, left: -40, width: 320, height: 320, borderRadius: 160, backgroundColor: "rgba(239,68,68,0.35)" },
  glowBottom: { position: "absolute", top: 220, right: -100, width: 360, height: 360, borderRadius: 180, backgroundColor: "rgba(124,12,12,0.55)" },

  banner: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20 },
  bannerTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  bannerBack: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingRight: 12 },
  bannerBackText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  drillBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)" },
  drillBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },

  sirenWrap: { alignSelf: "center", width: 90, height: 90, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  sirenPulse: { position: "absolute", width: 90, height: 90, borderRadius: 45, backgroundColor: "#FCA5A5" },
  sirenRing: { position: "absolute", width: 90, height: 90, borderRadius: 45, borderWidth: 4, borderColor: "#FECACA" },
  sirenCore: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: "#0B1020",
    alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: "rgba(255,255,255,0.25)",
  },

  bannerTitle: {
    color: "#FFFFFF", fontSize: 38, fontWeight: "900",
    letterSpacing: -1, lineHeight: 40, textAlign: "center", marginTop: 4,
  },
  alertChip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    alignSelf: "center", marginTop: 14,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 999,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  alertChipDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#FCA5A5" },
  alertChipText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  bannerMsg: { color: "#FECACA", fontSize: 14, marginTop: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 8 },

  sheetWrap: { paddingHorizontal: 12, paddingBottom: 24, flexGrow: 1 },
  sheet: {
    backgroundColor: C.surface, borderRadius: 28, padding: 22,
    ...(SHADOW.lg as any),
  },
  q: { ...TYPE.h2, textAlign: "center", marginBottom: 20, color: C.text },
  bigBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12,
    height: 92, borderRadius: 22, marginBottom: 14, overflow: "hidden",
    ...(SHADOW.md as any),
  },
  bigBtnText: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", letterSpacing: 0.5 },

  choice: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, backgroundColor: C.surface,
    borderWidth: 1.5, borderColor: C.borderStrong, borderRadius: RADIUS.md,
    marginBottom: 8,
  },
  choiceText: { fontSize: 16, fontWeight: "700", color: C.text },
  confirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 60, borderRadius: RADIUS.lg, marginTop: 14,
    ...(SHADOW.md as any),
  },
  confirmBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  note: {
    minHeight: 64, padding: 14, borderWidth: 1.5, borderColor: C.borderStrong,
    borderRadius: RADIUS.md, marginTop: 6, fontSize: 14, color: C.text, textAlignVertical: "top",
    backgroundColor: C.surface,
  },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderWidth: 1.5, borderColor: C.borderStrong, borderRadius: RADIUS.md, marginTop: 10,
  },
  toggleText: { flex: 1, fontSize: 13, fontWeight: "600", color: C.text },

  done: { alignItems: "center", paddingVertical: 14 },
  doneIconWrap: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  doneTitle: { ...TYPE.h2, marginTop: 18, textAlign: "center" },
  doneSub: { ...TYPE.body, marginTop: 8, textAlign: "center", paddingHorizontal: 8 },
  updateBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 22, paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1.5, borderColor: C.borderStrong, borderRadius: RADIUS.md, backgroundColor: C.surface,
  },
  updateText: { fontSize: 14, fontWeight: "700", color: C.text },
});
