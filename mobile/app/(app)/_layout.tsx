import { Redirect, Tabs } from "expo-router";
import { Text } from "react-native";

import { useSession } from "@/auth/session";
import { theme } from "@/ui/theme";

/** Everything under here requires a session; the gate is this redirect. */
export default function AppLayout() {
  const { user, loading } = useSession();

  if (loading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: "800" },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
        },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color }) => <TabGlyph glyph="◆" color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: "Bookings",
          tabBarIcon: ({ color }) => <TabGlyph glyph="▤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <TabGlyph glyph="●" color={color} />,
        }}
      />
    </Tabs>
  );
}

/** Glyphs rather than an icon package: one less dependency to version-match. */
function TabGlyph({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
}
