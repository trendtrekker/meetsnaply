import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { request } from "@/api/client";
import type { DashboardResponse } from "@/api/types";
import { messageFor, useSession } from "@/auth/session";
import { BookingCard } from "@/ui/BookingCard";
import { theme } from "@/ui/theme";

export default function Today() {
  const { user } = useSession();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => request<DashboardResponse>("/dashboard"),
  });

  const firstName = user?.name.split(" ")[0] ?? "there";

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={query.refetch}
          tintColor={theme.primary}
        />
      }
    >
      <Text style={styles.heading}>Ciao, {firstName}!</Text>
      <Text style={styles.sub}>What's coming up.</Text>

      {query.isPending ? (
        <ActivityIndicator style={styles.spinner} color={theme.primary} />
      ) : query.isError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{messageFor(query.error)}</Text>
          <Pressable onPress={() => query.refetch()}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {query.data.unconfirmedCount > 0 ? (
            <Link href="/(app)/bookings?tab=unconfirmed" asChild>
              <Pressable style={styles.notice}>
                <Text style={styles.noticeText}>
                  {query.data.unconfirmedCount} request
                  {query.data.unconfirmedCount === 1 ? "" : "s"} waiting on you
                </Text>
                <Text style={styles.noticeArrow}>→</Text>
              </Pressable>
            </Link>
          ) : null}

          {query.data.upcoming.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing scheduled</Text>
              <Text style={styles.emptyBody}>
                Confirmed meetings show up here as they're booked.
              </Text>
            </View>
          ) : (
            query.data.upcoming.map((booking) => (
              <BookingCard key={booking.uid} booking={booking} />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 28, fontWeight: "800", color: theme.text },
  sub: { marginTop: 4, marginBottom: 20, color: theme.textMuted, fontSize: 15 },
  spinner: { marginTop: 40 },
  errorBox: {
    backgroundColor: theme.primarySoft,
    borderRadius: theme.radius,
    padding: 16,
  },
  errorText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  retry: { marginTop: 12, color: theme.primary, fontWeight: "800" },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.primarySoft,
    borderRadius: theme.radius,
    padding: 16,
    marginBottom: 16,
  },
  noticeText: { color: theme.primary, fontWeight: "700", fontSize: 14 },
  noticeArrow: { color: theme.primary, fontWeight: "800", fontSize: 16 },
  empty: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 24,
    alignItems: "center",
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.text },
  emptyBody: {
    marginTop: 6,
    color: theme.textMuted,
    fontSize: 14,
    textAlign: "center",
  },
});
