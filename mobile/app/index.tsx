import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useSession } from "@/auth/session";
import { theme } from "@/ui/theme";

/**
 * The launch gate: wait for the stored token to be checked, then send the user
 * where they belong. Redirecting before that resolves would flash the login
 * screen at someone who is already signed in.
 */
export default function Index() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return <Redirect href={user ? "/(app)" : "/login"} />;
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.bg,
  },
});
