import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { loadAuth, clearAuth } from "../src/api";
import { C, RADIUS, SHADOW, TYPE } from "../src/theme";

const ROLES = [
  { key: "admin", title: "Admin", desc: "Organization, teams, members, assembly points.", icon: "options", grad: ["#0B1020", "#1F2547"] as const },
  { key: "firewatch", title: "Firewatch", desc: "Run drills and emergencies. Monitor team safety in real time.", icon: "shield-checkmark", grad: ["#DC2626", "#EF4444"] as const },
  { key: "member", title: "Team Member", desc: "Receive alerts. Confirm your safety with one tap.", icon: "people", grad: ["#16A34A", "#22C55E"] as const },
];

export default function RoleSelect() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { user, token } = await loadAuth();
      if (!token) router.replace("/"); else setUser(user);
    })();
  }, []);

  const choose = (role: string) => {
    if (role === "admin") router.push("/admin");
    else if (role === "firewatch") router.push("/firewatch");
    else router.push("/member");
  };
  const logout = async () => { await clearAuth(); router.replace("/"); };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>WELCOME BACK</Text>
            <Text style={styles.name} testID="user-name">{user?.name || ""}</Text>
          </View>
          <TouchableOpacity onPress={logout} testID="logout-btn" style={styles.logoutBtn} activeOpacity={0.85}>
            <Ionicons name="log-out-outline" size={18} color={C.text} />
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Choose your role</Text>
        <Text style={styles.sub}>Pick how you want to use SafeCount right now.</Text>

        <View style={styles.cards}>
          {ROLES.map((r) => (
            <TouchableOpacity
              key={r.key}
              testID={`role-${r.key}`}
              style={styles.card}
              onPress={() => choose(r.key)}
              activeOpacity={0.92}
            >
              <View style={styles.iconWrap}>
                <LinearGradient colors={r.grad} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                <Ionicons name={r.icon as any} size={26} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{r.title}</Text>
                <Text style={styles.cardDesc}>{r.desc}</Text>
              </View>
              <View style={styles.chevWrap}>
                <Ionicons name="chevron-forward" size={18} color={C.text} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footTip}>
          <Ionicons name="shield-checkmark-outline" size={16} color={C.textMuted} />
          <Text style={styles.footTipText}>Privacy-first · location sharing only during active emergencies</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 24 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 32 },
  kicker: { ...TYPE.label, color: C.accent },
  name: { ...TYPE.h2, marginTop: 4 },
  logoutBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    height: 40, paddingHorizontal: 14, borderRadius: RADIUS.md,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderStrong,
    ...(SHADOW.sm as any),
  },
  logoutText: { color: C.text, fontSize: 13, fontWeight: "700" },
  title: { ...TYPE.h1 },
  sub: { ...TYPE.body, marginTop: 6, marginBottom: 28 },
  cards: { gap: 14 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 16,
    padding: 18, backgroundColor: C.surface,
    borderRadius: RADIUS.xl, borderWidth: 1, borderColor: C.border,
    ...(SHADOW.sm as any),
  },
  iconWrap: { width: 54, height: 54, borderRadius: RADIUS.md, overflow: "hidden", alignItems: "center", justifyContent: "center", ...(SHADOW.sm as any) },
  cardTitle: { ...TYPE.h3, fontSize: 18, color: C.text },
  cardDesc: { fontSize: 13, color: C.textSub, marginTop: 4, lineHeight: 18 },
  chevWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.surfaceMuted, alignItems: "center", justifyContent: "center" },
  footTip: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 32, paddingHorizontal: 6 },
  footTipText: { fontSize: 12, color: C.textMuted },
});
