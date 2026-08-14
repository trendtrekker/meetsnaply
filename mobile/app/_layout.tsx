import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "@/auth/session";
import { theme } from "@/ui/theme";

export default function RootLayout() {
  // One client for the app's lifetime. Retries are limited because the usual
  // failure here is "phone is on the wrong network", and retrying that four
  // times just delays the error message the user needs to see.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000 },
        },
      }),
    [],
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.bg },
              headerTintColor: theme.text,
              headerTitleStyle: { fontWeight: "800" },
              contentStyle: { backgroundColor: theme.bg },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
            <Stack.Screen
              name="booking/[uid]"
              options={{ title: "Meeting", presentation: "card" }}
            />
          </Stack>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
