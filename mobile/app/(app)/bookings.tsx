import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { request } from "@/api/client";
import type { BookingTab, BookingsResponse } from "@/api/types";
import { messageFor } from "@/auth/session";
import { BookingCard } from "@/ui/BookingCard";
import { theme } from "@/ui/theme";

const TABS: { key: BookingTab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
];

export default function Bookings() {
  // The dashboard links here with ?tab=unconfirmed, so the initial tab comes
  // from the route rather than always starting on "upcoming".
  const params = useLocalSearchParams<{ tab?: string }>();
  const initial = TABS.some((t) => t.key === params.tab)
    ? (params.tab as BookingTab)
    : "upcoming";

  const [tab, setTab] = useState<BookingTab>(initial);

  const query = useQuery({
    queryKey: ["bookings", tab],
    queryFn: () => request<BookingsResponse>(`/bookings?tab=${tab}`),
  });

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {query.isPending ? (
        <ActivityIndicator style={styles.spinner} color={theme.primary} />
      ) : query.isError ? (
        <View style={styles.centre}>
          <Text style={styles.errorText}>{messageFor(query.error)}</Text>
          <Pressable onPress={() => query.refetch()}>
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={query.data.bookings}
          keyExtractor={(booking) => booking.uid}
          renderItem={({ item }) => <BookingCard booking={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={query.refetch}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Nothing in {TABS.find((t) => t.key === tab)?.label.toLowerCase()}.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  tabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  tabActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  tabText: { fontSize: 13, fontWeight: "700", color: theme.textMuted },
  tabTextActive: { color: "#fff" },
  list: { padding: 20, paddingTop: 12, paddingBottom: 40 },
  spinner: { marginTop: 40 },
  centre: { padding: 24 },
  errorText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  retry: { marginTop: 12, color: theme.primary, fontWeight: "800" },
  empty: { padding: 24, alignItems: "center" },
  emptyText: { color: theme.textMuted, fontSize: 14 },
});
