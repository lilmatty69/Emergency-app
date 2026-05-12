import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall } from "../src/api";

const TYPES = [
  { key: "fire", label: "Fire", icon: "flame" },
  { key: "gas_leak", label: "Gas leak", icon: "warning" },
  { key: "evacuation", label: "Evacuation", icon: "exit" },
  { key: "storm", label: "Storm / wind", icon: "thunderstorm" },
  { key: "security", label: "Security threat", icon: "shield" },
  { key: "other", label: "Other", icon: "ellipsis-horizontal-circle" },
];

export default function StartAlert() {
  const router = useRouter();
  const { teamId, mode } = useLocalSearchParams<{ teamId: string; mode: "drill" | "emergency" }>();
  const [type, setType] = useState("fire");
  const [message, setMessage] = useState("Emergency alert. Please confirm your safety immediately.");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isDrill = mode === "drill";

  const submit = async () => {
    setSubmitting(true);
    try {
      const alert = await apiCall("/alerts", {
        method: "POST",
        body: { type, mode, team_ids: [teamId], message },
      });
      router.replace({ pathname: "/firewatch-live", params: { alertId: alert.id } });
    } catch (e: any) {
      Alert.alert("Failed to start", e.message);
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, !isDrill && { backgroundColor: COLORS.emergencyHighlight }]} edges={["top", "bottom"]}>
      <View style={[styles.header, !isDrill && { backgroundColor: COLORS.emergencyBg }]}>
        <TouchableOpacity onPress={() => router.back()} testID="cancel-btn">
          <Ionicons name="close" size={28} color={isDrill ? COLORS.textPrimary : "#FFFFFF"} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, !isDrill && { color: "#FFFFFF" }]}>
          {isDrill ? "Start Drill" : "Start Emergency"}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.label}>Alert type</Text>
        <View style={styles.typeGrid}>
          {TYPES.map((t) => (
            <TouchableOpacity
              key={t.key}
              testID={`type-${t.key}`}
              style={[styles.typeChip, type === t.key && styles.typeChipActive]}
              onPress={() => setType(t.key)}
            >
              <Ionicons
                name={t.icon as any}
                size={20}
                color={type === t.key ? "#FFFFFF" : COLORS.textPrimary}
              />
              <Text style={[styles.typeChipText, type === t.key && { color: "#FFFFFF" }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Message to team</Text>
        <TextInput
          testID="alert-message"
          style={styles.textArea}
          multiline
          value={message}
          onChangeText={setMessage}
        />

        <View style={styles.notice}>
          <Ionicons
            name={isDrill ? "information-circle" : "warning"}
            size={22}
            color={isDrill ? COLORS.notAtLocation : COLORS.warning}
          />
          <Text style={styles.noticeText}>
            {isDrill
              ? "Practice mode — team members will be told this is a drill in the report."
              : "Real emergency — all team members will be alerted immediately."}
          </Text>
        </View>

        {confirming ? (
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Are you sure?</Text>
            <Text style={styles.confirmText}>
              {isDrill ? "Start drill for this team?" : "This will trigger a real emergency alert."}
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.surface }]} onPress={() => setConfirming(false)}>
                <Text style={[styles.btnText, { color: COLORS.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="confirm-start"
                style={[styles.btn, { backgroundColor: isDrill ? COLORS.primary : COLORS.emergencyBg }]}
                onPress={submit}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnText}>Start Alert</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            testID="start-alert-btn"
            style={[styles.startBtn, { backgroundColor: isDrill ? COLORS.primary : COLORS.emergencyBg }]}
            onPress={() => setConfirming(true)}
          >
            <Text style={styles.startBtnText}>{isDrill ? "START DRILL NOW" : "START ALERT NOW"}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingTop: 12 },
  headerTitle: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  scroll: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 12, fontWeight: "700", color: COLORS.textSecondary, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10, marginTop: 8 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: "#FFFFFF" },
  typeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  typeChipText: { fontSize: 13, fontWeight: "700", color: COLORS.textPrimary },
  textArea: { minHeight: 90, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, padding: 14, fontSize: 15, color: COLORS.textPrimary, backgroundColor: "#FFFFFF", textAlignVertical: "top" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, backgroundColor: COLORS.surface, borderRadius: 14, marginTop: 18 },
  noticeText: { flex: 1, fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
  startBtn: { height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center", marginTop: 28 },
  startBtnText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800", letterSpacing: 1 },
  confirmBox: { marginTop: 24, padding: 20, borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: COLORS.emergencyBg },
  confirmTitle: { fontSize: 18, fontWeight: "800", color: COLORS.textPrimary },
  confirmText: { fontSize: 14, color: COLORS.textSecondary, marginTop: 6, marginBottom: 16 },
  confirmRow: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
