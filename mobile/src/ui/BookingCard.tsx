import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { BookingSummary } from "@/api/types";
import { dayOf, durationBetween, timeOf } from "@/ui/format";
import { statusColor, theme } from "@/ui/theme";

/**
 * One meeting in a list. The time rail on the left mirrors the web dashboard,
 * where the eye scans down times rather than across titles.
 */
export function BookingCard({ booking }: { booking: BookingSummary }) {
  const zone = booking.timeZone;
  const guests = booking.attendees.length;

  return (
    <Link href={`/booking/${booking.uid}`} asChild>
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={styles.rail}>
          <Text style={styles.time}>{timeOf(booking.startTime, zone)}</Text>
          <Text style={styles.day}>{dayOf(booking.startTime, zone)}</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {booking.eventType.title}
          </Text>
          <Text style={styles.meta}>
            {durationBetween(booking.startTime, booking.endTime)}
            {guests > 0
              ? ` · ${guests} attendee${guests === 1 ? "" : "s"}`
              : ""}
          </Text>

          <View style={styles.badges}>
            <Badge
              label={booking.status}
              color={statusColor[booking.status] ?? theme.textMuted}
            />
            {booking.eventType.transcriptionEnabled ? (
              <Badge label="TRANSCRIBED" color={theme.primary} />
            ) : null}
            {booking.recap?.sentAt ? (
              <Badge label="RECAP SENT" color={statusColor.CONFIRMED} />
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 14,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 12,
  },
  pressed: { opacity: 0.7 },
  rail: { width: 62 },
  time: { fontSize: 20, fontWeight: "800", color: theme.text },
  day: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: theme.textMuted,
    letterSpacing: 0.5,
  },
  body: { flex: 1 },
  title: { fontSize: 16, fontWeight: "700", color: theme.text },
  meta: { marginTop: 3, fontSize: 13, color: theme.textMuted },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
});
