import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { apiBaseUrl } from "@/api/client";
import { useSession } from "@/auth/session";
import { theme } from "@/ui/theme";

export default function Account() {
  const { user, signOut } = useSession();

  async function leave() {
    await signOut();
    router.replace("/login");
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.handle}>@{user?.username}</Text>

        <Row label="Email" value={user?.email ?? "—"} />
        <Row label="Timezone" value={user?.timeZone ?? "—"} />
        <Row label="Server" value={apiBaseUrl()} />
      </View>

      {/* Editing lands in a later phase; saying so beats a control that
          silently does nothing. */}
      <Text style={styles.note}>
        Editing your profile, availability, and event types is still web-only.
      </Text>

      <Pressable
        onPress={leave}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
  },
  name: { fontSize: 22, fontWeight: "800", color: theme.text },
  handle: { marginTop: 2, color: theme.primary, fontWeight: "700" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  rowLabel: { color: theme.textMuted, fontSize: 13, fontWeight: "700" },
  rowValue: { color: theme.text, fontSize: 13, flexShrink: 1 },
  note: {
    marginTop: 16,
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    marginTop: 24,
    borderRadius: theme.radiusSmall,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingVertical: 14,
    alignItems: "center",
  },
  pressed: { opacity: 0.7 },
  buttonText: { color: theme.primary, fontWeight: "800", fontSize: 15 },
});
