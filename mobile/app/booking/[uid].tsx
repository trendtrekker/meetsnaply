import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { request } from "@/api/client";
import type { BookingDetailResponse } from "@/api/types";
import { messageFor } from "@/auth/session";
import { durationBetween, longDateOf, timeOf } from "@/ui/format";
import { statusColor, theme } from "@/ui/theme";

export default function BookingDetail() {
  const { uid } = useLocalSearchParams<{ uid: string }>();

  const query = useQuery({
    queryKey: ["booking", uid],
    queryFn: () => request<BookingDetailResponse>(`/bookings/${uid}`),
    enabled: Boolean(uid),
  });

  if (query.isPending) {
    return <ActivityIndicator style={styles.spinner} color={theme.primary} />;
  }

  if (query.isError) {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorText}>{messageFor(query.error)}</Text>
      </View>
    );
  }

  const { booking, jobs } = query.data;
  const zone = booking.timeZone;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{booking.eventType.title}</Text>
      <View style={[styles.pill, { borderColor: statusColor[booking.status] }]}>
        <Text style={[styles.pillText, { color: statusColor[booking.status] }]}>
          {booking.status}
        </Text>
      </View>

      <Section title="When">
        <Text style={styles.value}>{longDateOf(booking.startTime, zone)}</Text>
        <Text style={styles.muted}>
          {timeOf(booking.startTime, zone)}–{timeOf(booking.endTime, zone)} ·{" "}
          {durationBetween(booking.startTime, booking.endTime)} · {zone}
        </Text>
      </Section>

      {booking.meetingUrl ? (
        <Section title="Where">
          {/* Opened in the device browser rather than embedded: a video room
              inside the app would need a development build, not Expo Go. */}
          <Pressable onPress={() => Linking.openURL(booking.meetingUrl!)}>
            <Text style={styles.link} numberOfLines={2}>
              {booking.meetingUrl}
            </Text>
          </Pressable>
        </Section>
      ) : null}

      <Section title="Who">
        {booking.attendees.map((attendee) => (
          <View key={attendee.id} style={styles.person}>
            <Text style={styles.value}>{attendee.name}</Text>
            <Text style={styles.muted}>
              {attendee.email}
              {attendee.isGuest ? " · guest" : ""}
            </Text>
          </View>
        ))}
      </Section>

      {booking.answers.length > 0 ? (
        <Section title="Answers">
          {booking.answers.map((answer) => (
            <View key={answer.id} style={styles.person}>
              <Text style={styles.muted}>{answer.label}</Text>
              <Text style={styles.value}>{answer.value}</Text>
            </View>
          ))}
        </Section>
      ) : null}

      {booking.cancelReason ? (
        <Section title="Cancellation reason">
          <Text style={styles.value}>{booking.cancelReason}</Text>
        </Section>
      ) : null}

      {jobs.length > 0 ? (
        <Section title="Recap pipeline">
          {jobs.map((job) => (
            <View key={job.id} style={styles.job}>
              <Text style={styles.value}>{job.type}</Text>
              <Text style={styles.muted}>
                {job.status.toLowerCase()} · attempt {job.attempts}/
                {job.maxAttempts}
              </Text>
              {job.lastError ? (
                <Text style={styles.jobError} numberOfLines={3}>
                  {job.lastError}
                </Text>
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  spinner: { marginTop: 40 },
  centre: { padding: 24 },
  errorText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  title: { fontSize: 24, fontWeight: "800", color: theme.text },
  pill: {
    alignSelf: "flex-start",
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  pillText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  section: {
    marginTop: 22,
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: theme.textMuted,
    marginBottom: 10,
  },
  value: { fontSize: 15, color: theme.text, fontWeight: "600" },
  muted: { marginTop: 2, fontSize: 13, color: theme.textMuted },
  link: { fontSize: 14, color: theme.primary, fontWeight: "700" },
  person: { marginBottom: 12 },
  job: { marginBottom: 12 },
  jobError: { marginTop: 4, fontSize: 12, color: theme.primary },
});
