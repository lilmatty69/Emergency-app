import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Share, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import QRCode from "react-native-qrcode-svg";
import { apiCall } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

export default function TeamCode() {
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const load = async () => {
    try {
      const d = await apiCall(`/teams/${teamId}/join-code`);
      setData(d);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [teamId]);

  const copyCode = async () => {
    if (!data?.join_code) return;
    try {
      if (Platform.OS === "web" && (navigator as any).clipboard) {
        await (navigator as any).clipboard.writeText(data.join_code);
      }
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareCode = async () => {
    if (!data) return;
    try {
      await Share.share({
        message: `Join ${data.team_name} on SafeCount.\nEnter the 6-digit code: ${data.join_code}\nOr scan the QR shown by your Firewatch.`,
      });
    } catch {}
  };

  const regenerate = () => {
    Alert.alert(
      "Regenerate code?",
      "The current code will stop working immediately. Members already in the team are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Regenerate",
          style: "destructive",
          onPress: async () => {
            setRegenerating(true);
            try {
              await apiCall(`/teams/${teamId}/regenerate-code`, { method: "POST" });
              await load();
            } catch (e: any) {
              Alert.alert("Failed", e.message);
            } finally { setRegenerating(false); }
          },
        },
      ]
    );
  };

  if (loading || !data) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={C.accent} /></SafeAreaView>;
  }

  const qrValue = `SAFECOUNT:${data.join_code}`;
  const formatted = String(data.join_code).replace(/(\d{3})(\d{3})/, "$1 $2");

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite team members</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.body}>
        <View style={styles.infoCard}>
          <InfoRow label="Organization" value={data.organization_name || "—"} icon="business-outline" />
          <View style={styles.infoDivider} />
          <InfoRow label="Team" value={data.team_name} icon="people-outline" />
          <View style={styles.infoDivider} />
          <InfoRow label="Firewatch" value={data.firewatch_name || "—"} icon="shield-checkmark-outline" />
        </View>

        <View style={styles.qrCard}>
          <View style={styles.qrWrap}>
            <QRCode value={qrValue} size={200} color={C.text} backgroundColor="#FFFFFF" />
          </View>
          <Text style={styles.qrHint}>Scan to join</Text>

          <View style={styles.codeChipRow}>
            <View style={styles.codeChip}>
              <Text style={styles.codeChipLabel}>6-DIGIT JOIN CODE</Text>
              <Text style={styles.codeChipValue} testID="join-code">{formatted}</Text>
            </View>
            <TouchableOpacity onPress={copyCode} style={styles.copyBtn} testID="copy-code">
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={22} color={copied ? C.safe : C.accent} />
            </TouchableOpacity>
          </View>
          {copied ? <Text style={styles.copiedHint}>Copied to clipboard</Text> : null}
        </View>

        <Text style={styles.helpText}>
          Team members can scan this QR code or enter the 6-digit code to join your team.
        </Text>

        <View style={styles.btnRow}>
          <TouchableOpacity onPress={shareCode} style={styles.shareBtn} activeOpacity={0.9} testID="share-code">
            <LinearGradient colors={["#0B1020", "#1F2547"]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
            <Ionicons name="share-outline" size={18} color="#FFFFFF" />
            <Text style={styles.shareBtnText}>Share invite</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={regenerate} style={styles.regenBtn} testID="regenerate-code" disabled={regenerating}>
            {regenerating ? <ActivityIndicator color={C.text} /> : (
              <>
                <Ionicons name="refresh" size={18} color={C.text} />
                <Text style={styles.regenBtnText}>Regenerate</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, icon }: any) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}><Ionicons name={icon} size={16} color={C.textSub} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  headerTitle: { ...TYPE.h3, fontSize: 16 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, padding: 20 },

  infoCard: { padding: 6, backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.border, ...(SHADOW.sm as any) },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  infoIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.surfaceMuted, alignItems: "center", justifyContent: "center" },
  infoLabel: { ...TYPE.label, fontSize: 9 },
  infoValue: { fontSize: 14, fontWeight: "700", color: C.text, marginTop: 1 },
  infoDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 12 },

  qrCard: { marginTop: 16, padding: 22, backgroundColor: C.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.border, alignItems: "center", ...(SHADOW.md as any) },
  qrWrap: { padding: 14, backgroundColor: "#FFFFFF", borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.border },
  qrHint: { fontSize: 11, color: C.textMuted, marginTop: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  codeChipRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginTop: 16, width: "100%" },
  codeChip: { flex: 1, padding: 12, backgroundColor: C.accentSoft, borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#DFE2FF" },
  codeChipLabel: { ...TYPE.label, color: C.accent, fontSize: 9 },
  codeChipValue: { fontSize: 30, fontWeight: "900", color: C.text, letterSpacing: 6, marginTop: 2, fontVariant: ["tabular-nums"] },
  copyBtn: { width: 52, borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#DFE2FF", backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  copiedHint: { fontSize: 12, color: C.safe, fontWeight: "700", marginTop: 8 },

  helpText: { fontSize: 13, color: C.textSub, lineHeight: 18, textAlign: "center", marginTop: 16, marginBottom: 4 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  shareBtn: { flex: 1.2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: RADIUS.md, overflow: "hidden", ...(SHADOW.md as any) },
  shareBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  regenBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: RADIUS.md, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.borderStrong },
  regenBtnText: { color: C.text, fontSize: 14, fontWeight: "700" },
});
