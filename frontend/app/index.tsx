import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, apiCall, saveAuth, loadAuth } from "../src/api";

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
    if (!email || !password) {
      Alert.alert("Missing fields", "Please enter email and password.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiCall("/auth/login", { method: "POST", body: { email, password }, auth: false });
      await saveAuth(data.token, data.user);
      router.replace("/role-select");
    } catch (e: any) {
      Alert.alert("Login failed", e.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (role: "admin" | "firewatch" | "member") => {
    const map = {
      admin: "admin@safecount.demo",
      firewatch: "jonas@safecount.demo",
      member: "ruta@safecount.demo",
    };
    setEmail(map[role]);
    setPassword("Demo1234");
  };

  if (bootChecking) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <View style={styles.logoBadge}>
              <Ionicons name="shield-checkmark" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.brand} testID="brand-title">SafeCount</Text>
            <Text style={styles.tagline}>Emergency accountability for your organization.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email or phone</Text>
            <TextInput
              testID="login-email"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="you@organization.com"
              placeholderTextColor="#94A3B8"
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="login-password"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
            />
            <TouchableOpacity
              testID="login-submit"
              style={[styles.btnPrimary, loading && { opacity: 0.6 }]}
              onPress={submit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.btnPrimaryText}>Log in</Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>DEMO ACCOUNTS</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.demoRow}>
              <TouchableOpacity testID="demo-admin" style={styles.demoChip} onPress={() => fillDemo("admin")}>
                <Text style={styles.demoChipText}>Admin</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="demo-firewatch" style={styles.demoChip} onPress={() => fillDemo("firewatch")}>
                <Text style={styles.demoChipText}>Firewatch</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="demo-member" style={styles.demoChip} onPress={() => fillDemo("member")}>
                <Text style={styles.demoChipText}>Member</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.demoHint}>Tap a role to autofill, then press Log in.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 24, paddingTop: 32, flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  logoWrap: { alignItems: "center", marginTop: 32, marginBottom: 40 },
  logoBadge: {
    width: 64, height: 64, borderRadius: 18, backgroundColor: COLORS.primary,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  brand: { fontSize: 32, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: COLORS.textSecondary, marginTop: 6, textAlign: "center" },
  form: { gap: 6 },
  label: { fontSize: 12, fontWeight: "700", color: COLORS.textSecondary, marginTop: 12, letterSpacing: 0.5, textTransform: "uppercase" },
  input: {
    height: 52, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12,
    paddingHorizontal: 16, fontSize: 16, color: COLORS.textPrimary, backgroundColor: "#FFFFFF",
  },
  btnPrimary: {
    height: 56, backgroundColor: COLORS.primary, borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginTop: 24,
  },
  btnPrimaryText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 24, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { fontSize: 11, fontWeight: "700", color: COLORS.textSecondary, letterSpacing: 1.5 },
  demoRow: { flexDirection: "row", gap: 8 },
  demoChip: {
    flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5,
    borderColor: COLORS.border, alignItems: "center", justifyContent: "center",
  },
  demoChipText: { fontSize: 14, fontWeight: "600", color: COLORS.textPrimary },
  demoHint: { fontSize: 12, color: COLORS.textSecondary, textAlign: "center", marginTop: 12 },
});
