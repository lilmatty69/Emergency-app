import { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall } from "../src/api";

export default function MemberHome() {
  const router = useRouter();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const [team, active] = await Promise.all([
        apiCall("/teams/mine-member"),
        apiCall("/alerts/active"),
      ]);
      setInfo({ team, active });
      if (active && active.status === "active") {
        router.push({ pathname: "/member-alert", params: { alertId: active.id } });
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    return () => clearInterval(pollRef.current);
  }, [load]));

  if (loading) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={COLORS.primary} /></SafeAreaView>;
  }

  const team = info?.team?.team;
  const fw = info?.team?.firewatch_name;
  const ap = info?.team?.assembly_point;
  const org = info?.team?.organization;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="back-btn">
          <Ionicons name="arrow-back" size={26} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Home</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.calmCard}>
          <View style={styles.greenDot} />
          <Text style={styles.calmText}>All clear · No active emergencies</Text>
        </View>

        <View style={styles.bigCard}>
          <Text style={styles.smLabel}>Organization</Text>
          <Text style={styles.bigText} testID="org-name">{org?.name || "—"}</Text>

          <View style={styles.divider} />

          <Text style={styles.smLabel}>Team</Text>
          <Text style={styles.bigText} testID="team-name">{team?.name || "—"}</Text>

          <View style={styles.divider} />

          <Text style={styles.smLabel}>Firewatch</Text>
          <Text style={styles.bigText} testID="firewatch-name">{fw || "—"}</Text>

          <View style={styles.divider} />

          <Text style={styles.smLabel}>Assembly point</Text>
          <Text style={styles.bigText} testID="assembly-name">{ap?.name || "—"}</Text>
          {ap?.description ? <Text style={styles.helpText}>{ap.description}</Text> : null}
        </View>

        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Emergency instructions</Text>
          <Tip n={1} t="Stay calm. Stop what you are doing." />
          <Tip n={2} t="Leave via the nearest safe exit. Do not use elevators." />
          <Tip n={3} t="Go directly to your assembly point." />
          <Tip n={4} t="Open SafeCount and mark yourself safe — or tap I need help." />
          <Tip n={5} t="Wait for your Firewatch to confirm everyone is accounted for." />
        </View>

        <View style={styles.testRow}>
          <Ionicons name="lock-closed" size={16} color={COLORS.textSecondary} />
          <Text style={styles.privacyText}>
            Location sharing is OFF in normal mode. Enabled only during an active emergency, with your consent.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tip({ n, t }: { n: number; t: string }) {
  return (
    <View style={styles.tipRow}>
      <View style={styles.tipNum}><Text style={styles.tipNumText}>{n}</Text></View>
      <Text style={styles.tipText}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.textPrimary },
  scroll: { padding: 20, paddingBottom: 40 },
  calmCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: "#ECFDF5", borderRadius: 14, borderWidth: 1, borderColor: "#A7F3D0" },
  greenDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.safe },
  calmText: { fontSize: 14, fontWeight: "700", color: "#065F46" },
  bigCard: { padding: 22, backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.border, marginTop: 16 },
  smLabel: { fontSize: 11, fontWeight: "700", color: COLORS.textSecondary, letterSpacing: 1, textTransform: "uppercase" },
  bigText: { fontSize: 20, fontWeight: "800", color: COLORS.textPrimary, marginTop: 4 },
  helpText: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 14 },
  tipsCard: { marginTop: 16, padding: 22, backgroundColor: COLORS.surface, borderRadius: 18 },
  tipsTitle: { fontSize: 14, fontWeight: "800", color: COLORS.textPrimary, textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 },
  tipRow: { flexDirection: "row", gap: 12, marginBottom: 10, alignItems: "flex-start" },
  tipNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center" },
  tipNumText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  tipText: { flex: 1, fontSize: 14, color: COLORS.textPrimary, lineHeight: 20 },
  testRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 16, paddingHorizontal: 4 },
  privacyText: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 17 },
});
