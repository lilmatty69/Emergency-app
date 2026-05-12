import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, loadAuth, clearAuth } from "../src/api";

const ROLES = [
  { key: "admin", title: "Admin", desc: "Manage organization, teams, members and assembly points.", icon: "settings", color: "#0F172A" },
  { key: "firewatch", title: "Firewatch", desc: "Start drills or emergencies. Monitor team safety live.", icon: "shield-checkmark", color: COLORS.needsHelp },
  { key: "member", title: "Team Member", desc: "Receive alerts. Confirm your safety quickly.", icon: "people", color: COLORS.safe },
];

export default function RoleSelect() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { user, token } = await loadAuth();
      if (!token) router.replace("/");
      else setUser(user);
    })();
  }, []);

  const choose = (role: string) => {
    if (role === "admin") router.push("/admin");
    else if (role === "firewatch") router.push("/firewatch");
    else router.push("/member");
  };

  const logout = async () => {
    await clearAuth();
    router.replace("/");
  };

  const available = (user?.roles || ["admin", "firewatch", "member"]) as string[];

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>Welcome back</Text>
            <Text style={styles.name} testID="user-name">{user?.name || ""}</Text>
          </View>
          <TouchableOpacity onPress={logout} testID="logout-btn" style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>Choose your role</Text>
        <Text style={styles.sub}>Pick how you want to use SafeCount right now.</Text>

        <View style={styles.cards}>
          {ROLES.filter((r) => available.includes(r.key) || available.length === 0).map((r) => (
            <TouchableOpacity
              key={r.key}
              testID={`role-${r.key}`}
              style={styles.card}
              onPress={() => choose(r.key)}
              activeOpacity={0.8}
            >
              <View style={[styles.iconWrap, { backgroundColor: r.color }]}>
                <Ionicons name={r.icon as any} size={26} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{r.title}</Text>
                <Text style={styles.cardDesc}>{r.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 24 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 32 },
  hello: { fontSize: 13, color: COLORS.textSecondary, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: "600" },
  name: { fontSize: 22, fontWeight: "800", color: COLORS.textPrimary, marginTop: 2 },
  logoutBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "800", color: COLORS.textPrimary, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: COLORS.textSecondary, marginTop: 6, marginBottom: 24 },
  cards: { gap: 12 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 16, padding: 18,
    backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.border,
  },
  iconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 17, fontWeight: "700", color: COLORS.textPrimary },
  cardDesc: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 },
});
