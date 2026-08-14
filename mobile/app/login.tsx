import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiBaseUrl } from "@/api/client";
import { messageFor, useSession } from "@/auth/session";
import { theme } from "@/ui/theme";

export default function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace("/(app)");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.brand}>meetsnaply</Text>
          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.sub}>Log in to see your meeting schedule.</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              style={styles.input}
            />

            <Text style={[styles.label, styles.spaced]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={theme.textMuted}
              secureTextEntry
              textContentType="password"
              style={styles.input}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                (pressed || busy) && styles.buttonPressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Log in</Text>
              )}
            </Pressable>
          </View>

          {/* Which server this build talks to is the first thing to check when
              nothing loads, so it is on screen rather than buried in a log. */}
          <Text style={styles.host}>{apiBaseUrl()}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  fill: { flex: 1 },
  content: { padding: 24, paddingTop: 48, flexGrow: 1 },
  brand: {
    color: theme.primary,
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 28,
  },
  heading: { fontSize: 30, fontWeight: "800", color: theme.text },
  sub: { marginTop: 6, color: theme.textMuted, fontSize: 15 },
  card: {
    marginTop: 28,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
  },
  label: { fontSize: 13, fontWeight: "700", color: theme.text },
  spaced: { marginTop: 16 },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusSmall,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.bg,
  },
  error: {
    marginTop: 16,
    color: theme.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  button: {
    marginTop: 20,
    backgroundColor: theme.primary,
    borderRadius: theme.radiusSmall,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  host: {
    marginTop: "auto",
    paddingTop: 24,
    textAlign: "center",
    color: theme.textMuted,
    fontSize: 12,
  },
});
