import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCall, saveAuth, loadAuth } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootChecking, setBootChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const { token } = await loadAuth();
      if (token) router.replace("/role-select");
      else setBootChecking(false);
    })();
  }, []);

  const submit = async () => {
    if (!email || !password) { Alert.alert("Missing fields", "Please enter email and password."); return; }
    setLoading(true);
    try {
      const data = await apiCall("/auth/login", { method: "POST", body: { email, password }, auth: false });
      await saveAuth(data.token, data.user);
      router.replace("/role-select");
    } catch (e: any) {
      Alert.alert("Login failed", e.message || "Invalid credentials");
    } finally { setLoading(false); }
  };

  const fillDemo = (role: "admin" | "firewatch" | "member") => {
    const map = { admin: "admin@safecount.demo", firewatch: "jonas@safecount.demo", member: "ruta@safecount.demo" };
    setEmail(map[role]); setPassword("Demo1234");
  };

  if (bootChecking) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color={C.accent} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Soft accent gradient hero backdrop */}
      <View style={styles.heroBg} pointerEvents="none">
        <LinearGradient
          colors={["#EEF0FF", "#FAFAFB"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }}
        />
        <View style={styles.glowA} />
        <View style={styles.glowB} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <View style={styles.logoBadge}>
              <LinearGradient
                colors={["#5B5BF5", "#7C3AED"]}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              />
              <Ionicons name="shield-checkmark" size={30} color="#FFFFFF" />
            </View>
            <Text style={styles.brand} testID="brand-title">SafeCount</Text>
            <Text style={styles.tagline}>Emergency accountability,{"\n"}built for calm clarity.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Email or phone</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color={C.textMuted} />
              <TextInput
                testID="login-email"
                style={styles.input}
                value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address"
                placeholder="you@organization.com" placeholderTextColor={C.textMuted}
              />
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
              <TextInput
                testID="login-password"
                style={styles.input}
                value={password} onChangeText={setPassword}
                secureTextEntry placeholder="••••••••" placeholderTextColor={C.textMuted}
              />
            </View>

            <TouchableOpacity
              testID="login-submit"
              style={[styles.cta, loading && { opacity: 0.7 }]}
              onPress={submit} disabled={loading} activeOpacity={0.9}
            >
              <LinearGradient
                colors={["#0B1020", "#1F2547"]}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              />
              {loading ? <ActivityIndicator color="#FFFFFF" /> : (
                <>
                  <Text style={styles.ctaText}>Log in</Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.demoSection}>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>QUICK DEMO ACCESS</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.demoRow}>
              <DemoChip testID="demo-admin" label="Admin" icon="settings-outline" onPress={() => fillDemo("admin")} />
              <DemoChip testID="demo-firewatch" label="Firewatch" icon="shield-checkmark-outline" onPress={() => fillDemo("firewatch")} accent />
              <DemoChip testID="demo-member" label="Member" icon="person-outline" onPress={() => fillDemo("member")} />
            </View>
            <Text style={styles.demoHint}>Tap a role to autofill, then Log in.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DemoChip({ testID, label, icon, onPress, accent }: any) {
  return (
    <TouchableOpacity testID={testID} style={[styles.chip, accent && styles.chipAccent]} onPress={onPress} activeOpacity={0.85}>
      <Ionicons name={icon} size={18} color={accent ? "#FFFFFF" : C.text} />
      <Text style={[styles.chipText, accent && { color: "#FFFFFF" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  heroBg: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  glowA: { position: "absolute", top: -120, right: -60, width: 300, height: 300, borderRadius: 150, backgroundColor: "rgba(91,91,245,0.18)" },
  glowB: { position: "absolute", top: 40, left: -80, width: 260, height: 260, borderRadius: 130, backgroundColor: "rgba(124,58,237,0.10)" },
  scroll: { padding: 24, paddingTop: 40, flexGrow: 1 },
  logoWrap: { alignItems: "center", marginTop: 24, marginBottom: 32 },
  logoBadge: {
    width: 68, height: 68, borderRadius: 20, overflow: "hidden",
    alignItems: "center", justifyContent: "center", marginBottom: 18,
    ...(SHADOW.md as any),
  },
  brand: { ...TYPE.h1, fontSize: 34, color: C.text },
  tagline: { ...TYPE.body, marginTop: 8, textAlign: "center" },

  card: { backgroundColor: C.surface, borderRadius: RADIUS.xl, padding: 22, borderWidth: 1, borderColor: C.border, ...(SHADOW.md as any) },
  label: { ...TYPE.label, marginBottom: 8 },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    height: 52, borderWidth: 1.5, borderColor: C.borderStrong, borderRadius: RADIUS.md,
    paddingHorizontal: 14, backgroundColor: "#FFFFFF",
  },
  input: { flex: 1, fontSize: 16, color: C.text },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 56, borderRadius: RADIUS.md, marginTop: 22, overflow: "hidden",
    ...(SHADOW.md as any),
  },
  ctaText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },

  demoSection: { marginTop: 24 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontSize: 10, fontWeight: "800", color: C.textMuted, letterSpacing: 1.6 },
  demoRow: { flexDirection: "row", gap: 8 },
  chip: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    height: 48, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: C.borderStrong, backgroundColor: C.surface,
  },
  chipAccent: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 13, fontWeight: "700", color: C.text },
  demoHint: { fontSize: 12, color: C.textMuted, textAlign: "center", marginTop: 12 },
});
