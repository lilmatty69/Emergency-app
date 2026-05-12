import { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCall } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

type Step = "input" | "confirm" | "done";

export default function JoinTeam() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const normalize = (raw: string) => raw.trim().replace(/^SAFECOUNT:/i, "").replace(/\s/g, "").toUpperCase();

  const findTeam = async () => {
    const c = normalize(code);
    if (c.length < 6) {
      Alert.alert("Enter code", "Please enter the full 6-digit code.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiCall(`/teams/lookup?code=${encodeURIComponent(c)}`);
      setPreview(data);
      setStep("confirm");
    } catch (e: any) {
      const msg = (e.message || "").includes("404") || (e.message || "").toLowerCase().includes("not found")
        ? "Code not found. Please double-check with your Firewatch."
        : e.message || "Something went wrong. Please try again.";
      Alert.alert("Couldn't find team", msg);
    } finally { setLoading(false); }
  };

  const confirmJoin = async () => {
    const c = normalize(code);
    setLoading(true);
    try {
      await apiCall("/teams/join", { method: "POST", body: { code: c } });
      setStep("done");
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.toLowerCase().includes("already")) {
        Alert.alert("Already a member", "You are already in this team.");
      } else if (msg.toLowerCase().includes("not found")) {
        Alert.alert("Code not found", "This code is no longer valid. Ask your Firewatch for a new one.");
      } else {
        Alert.alert("Couldn't join", msg || "Something went wrong. Please try again.");
      }
    } finally { setLoading(false); }
  };

  const tryScan = () => {
    Alert.alert(
      "Scan QR code",
      "Open your phone's camera and point it at the QR shown by your Firewatch. The code will appear — type it on the next screen.",
      [{ text: "OK" }]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (step === "input" ? router.back() : setStep("input"))}
          testID="back-btn"
          style={styles.iconBtn}
        >
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Join a team</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === "input" && (
            <>
              <Text style={styles.kicker}>WELCOME</Text>
              <Text style={styles.title}>Join your team</Text>
              <Text style={styles.sub}>Scan the QR code or enter the 6-digit code from your Firewatch.</Text>

              <TouchableOpacity onPress={tryScan} style={styles.scanCard} activeOpacity={0.92} testID="scan-btn">
                <View style={styles.scanIcon}><Ionicons name="qr-code-outline" size={28} color={C.accent} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scanTitle}>Scan QR code</Text>
                  <Text style={styles.scanSub}>Use your phone's camera</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.textMuted} />
              </TouchableOpacity>

              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>OR ENTER 6-DIGIT CODE</Text>
                <View style={styles.orLine} />
              </View>

              <Text style={styles.label}>Team code</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="key-outline" size={18} color={C.textMuted} />
                <TextInput
                  testID="join-code-input"
                  style={styles.input}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="000000"
                  placeholderTextColor={C.textMuted}
                  maxLength={6}
                />
              </View>

              <TouchableOpacity
                testID="find-team"
                style={[styles.cta, (loading || code.length < 6) && { opacity: 0.5 }]}
                onPress={findTeam}
                disabled={loading || code.length < 6}
                activeOpacity={0.9}
              >
                <LinearGradient colors={["#0B1020", "#1F2547"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                {loading ? <ActivityIndicator color="#FFFFFF" /> : (
                  <>
                    <Text style={styles.ctaText}>Find team</Text>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.demoTip}>
                <Ionicons name="bulb-outline" size={16} color={C.accent} />
                <Text style={styles.demoTipText}>
                  Demo tip: try the code <Text style={{ fontWeight: "800", color: C.text }}>482913</Text> to join Warehouse Shift A.
                </Text>
              </View>
            </>
          )}

          {step === "confirm" && preview && (
            <>
              <View style={styles.confirmBadge}>
                <Ionicons name="people" size={28} color={C.accent} />
              </View>
              <Text style={styles.confirmTitle}>Confirm team</Text>
              <Text style={styles.confirmSub}>Do you want to join this team?</Text>

              <View style={styles.previewCard}>
                <PreviewRow label="Organization" value={preview.organization?.name || "—"} icon="business-outline" />
                <View style={styles.infoDivider} />
                <PreviewRow label="Team" value={preview.team?.name || "—"} icon="people-outline" />
                <View style={styles.infoDivider} />
                <PreviewRow label="Firewatch" value={preview.firewatch?.name || "—"} icon="shield-checkmark-outline" />
                <View style={styles.infoDivider} />
                <PreviewRow label="Current members" value={String(preview.team?.member_count || 0)} icon="person-outline" />
              </View>

              {preview.already_member ? (
                <View style={styles.warning}>
                  <Ionicons name="checkmark-circle" size={18} color={C.safe} />
                  <Text style={styles.warningText}>You are already in this team.</Text>
                </View>
              ) : null}

              <View style={styles.confirmBtnRow}>
                <TouchableOpacity testID="cancel-join" style={styles.cancelBtn} onPress={() => setStep("input")}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="confirm-join"
                  style={[styles.joinBtn, preview.already_member && { opacity: 0.4 }]}
                  onPress={confirmJoin}
                  disabled={loading || preview.already_member}
                  activeOpacity={0.9}
                >
                  <LinearGradient colors={["#16A34A", "#22C55E"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                  {loading ? <ActivityIndicator color="#FFFFFF" /> : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                      <Text style={styles.joinBtnText}>Join team</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === "done" && preview && (
            <View style={styles.doneWrap}>
              <View style={styles.doneIcon}>
                <Ionicons name="checkmark-circle" size={64} color={C.safe} />
              </View>
              <Text style={styles.doneTitle}>You have joined{"\n"}{preview.team?.name}</Text>
              <Text style={styles.doneSub}>
                {preview.firewatch?.name ? `${preview.firewatch.name} is your Firewatch.` : ""}
              </Text>
              <TouchableOpacity
                testID="go-home"
                style={styles.cta}
                onPress={() => router.replace("/member")}
                activeOpacity={0.9}
              >
                <LinearGradient colors={["#0B1020", "#1F2547"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                <Text style={styles.ctaText}>Open my home</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PreviewRow({ label, value, icon }: any) {
  return (
    <View style={styles.previewRow}>
      <View style={styles.previewIcon}><Ionicons name={icon} size={16} color={C.textSub} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.previewLabel}>{label}</Text>
        <Text style={styles.previewValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  headerTitle: { ...TYPE.h3, fontSize: 16 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 20, paddingBottom: 40 },
  kicker: { ...TYPE.label, color: C.accent, marginTop: 8 },
  title: { ...TYPE.h1, marginTop: 6 },
  sub: { ...TYPE.body, marginTop: 6, marginBottom: 24 },

  scanCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: C.borderStrong, ...(SHADOW.sm as any) },
  scanIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  scanTitle: { ...TYPE.h3, fontSize: 16 },
  scanSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },

  orRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 22 },
  orLine: { flex: 1, height: 1, backgroundColor: C.border },
  orText: { fontSize: 10, fontWeight: "800", color: C.textMuted, letterSpacing: 1.6 },

  label: { ...TYPE.label, marginBottom: 8 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, height: 68, borderWidth: 1.5, borderColor: C.borderStrong, borderRadius: RADIUS.md, paddingHorizontal: 16, backgroundColor: C.surface },
  input: { flex: 1, fontSize: 28, fontWeight: "900", color: C.text, letterSpacing: 8, fontVariant: ["tabular-nums"] },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 56, borderRadius: RADIUS.md, marginTop: 18, overflow: "hidden", ...(SHADOW.md as any) },
  ctaText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },

  demoTip: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 22, padding: 14, backgroundColor: C.accentSoft, borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#DFE2FF" },
  demoTipText: { flex: 1, fontSize: 13, color: C.textSub, lineHeight: 18 },

  confirmBadge: { alignSelf: "center", marginTop: 8, width: 64, height: 64, borderRadius: 18, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  confirmTitle: { ...TYPE.h1, textAlign: "center", marginTop: 14 },
  confirmSub: { ...TYPE.body, textAlign: "center", marginTop: 6, marginBottom: 22 },
  previewCard: { padding: 6, backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.border, ...(SHADOW.sm as any) },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  previewIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.surfaceMuted, alignItems: "center", justifyContent: "center" },
  previewLabel: { ...TYPE.label, fontSize: 9 },
  previewValue: { fontSize: 15, fontWeight: "700", color: C.text, marginTop: 1 },
  infoDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 12 },

  warning: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, padding: 12, backgroundColor: "#ECFDF5", borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#A7F3D0" },
  warningText: { flex: 1, fontSize: 13, fontWeight: "700", color: "#065F46" },

  confirmBtnRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, height: 54, borderRadius: RADIUS.md, backgroundColor: C.surfaceMuted, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { fontSize: 15, fontWeight: "700", color: C.text },
  joinBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: RADIUS.md, overflow: "hidden", ...(SHADOW.md as any) },
  joinBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },

  doneWrap: { alignItems: "center", paddingTop: 20 },
  doneIcon: { width: 110, height: 110, borderRadius: 55, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  doneTitle: { ...TYPE.h1, textAlign: "center", marginTop: 20 },
  doneSub: { ...TYPE.body, textAlign: "center", marginTop: 8, paddingHorizontal: 8 },
});
