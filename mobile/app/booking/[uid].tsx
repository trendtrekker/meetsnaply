import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
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
import {
  useReprocessRecording,
  useRetryPipelineJob,
  useSetBookingStatus,
} from "@/api/mutations";
import type { BookingDetailResponse, PipelineJob } from "@/api/types";
import { messageFor } from "@/auth/session";
import { ActionButton } from "@/ui/Button";
import { durationBetween, longDateOf, timeOf } from "@/ui/format";
import { statusColor, theme } from "@/ui/theme";

export default function BookingDetail() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["booking", uid],
    queryFn: () => request<BookingDetailResponse>(`/bookings/${uid}`),
    enabled: Boolean(uid),
  });

  const setStatus = useSetBookingStatus(uid);
  const retryJob = useRetryPipelineJob(uid);
  const reprocess = useReprocessRecording(uid);

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
  const busy = setStatus.isPending;

  /** Runs a mutation and keeps its failure on screen rather than throwing. */
  function run(action: () => Promise<unknown>) {
    setActionError(null);
    action().catch((caught) => setActionError(messageFor(caught)));
  }

  const isPending = booking.status === "PENDING";
  const isConfirmed = booking.status === "CONFIRMED";
  const isOver = new Date(booking.endTime).getTime() < Date.now();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{booking.eventType.title}</Text>
      <View style={[styles.pill, { borderColor: statusColor[booking.status] }]}>
        <Text style={[styles.pillText, { color: statusColor[booking.status] }]}>
          {booking.status}
        </Text>
      </View>

      {/* Actions sit directly under the status, which is what they change. */}
      {isPending ? (
        <View style={styles.actions}>
          <ActionButton
            label="Approve"
            busy={busy}
            onPress={() => run(() => setStatus.mutateAsync("CONFIRMED"))}
          />
          <ActionButton
            label="Decline"
            variant="danger"
            busy={busy}
            confirm={{
              title: "Decline this request?",
              message:
                "The invitee is emailed that it isn't happening. This can't be undone.",
              destructive: true,
            }}
            onPress={() => run(() => setStatus.mutateAsync("REJECTED"))}
          />
        </View>
      ) : null}

      {isConfirmed && !isOver ? (
        <View style={styles.actions}>
          <ActionButton
            label="Cancel meeting"
            variant="danger"
            busy={busy}
            confirm={{
              title: "Cancel this meeting?",
              message:
                "Everyone is emailed, and it comes off the calendar. This can't be undone.",
              destructive: true,
            }}
            onPress={() => run(() => setStatus.mutateAsync("CANCELLED"))}
          />
        </View>
      ) : null}

      {actionError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{actionError}</Text>
        </View>
      ) : null}

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

      {jobs.length > 0 || booking.recording ? (
        <Section title="Recap pipeline">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              busy={retryJob.isPending}
              onRetry={() => run(() => retryJob.mutateAsync(job.id))}
            />
          ))}

          {booking.recording ? (
            <ActionButton
              label="Reprocess recording"
              variant="outline"
              busy={reprocess.isPending}
              confirm={{
                title: "Reprocess this recording?",
                message:
                  "Runs the pipeline again from the start. Useful when a webhook never arrived.",
              }}
              onPress={() => run(() => reprocess.mutateAsync())}
              style={styles.fullWidth}
            />
          ) : null}
        </Section>
      ) : null}
    </ScrollView>
  );
}

/** One pipeline stage, with a retry offered only where retrying makes sense. */
function JobRow({
  job,
  busy,
  onRetry,
}: {
  job: PipelineJob;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <View style={styles.job}>
      <View style={styles.jobHead}>
        <Text style={styles.value}>{job.type}</Text>
        <Text
          style={[
            styles.jobStatus,
            job.status === "FAILED" && { color: theme.primary },
            job.status === "DONE" && { color: statusColor.CONFIRMED },
          ]}
        >
          {job.status.toLowerCase()}
        </Text>
      </View>

      <Text style={styles.muted}>
        attempt {job.attempts}/{job.maxAttempts}
      </Text>

      {job.lastError ? (
        <Text style={styles.jobError} numberOfLines={3}>
          {job.lastError}
        </Text>
      ) : null}

      {/* A dead job is the only one worth a manual retry: the queue already
          retries the rest on its own backoff. */}
      {job.status === "FAILED" ? (
        <ActionButton
          label="Retry"
          variant="outline"
          busy={busy}
          onPress={onRetry}
          style={styles.retry}
        />
      ) : null}
    </View>
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
  errorBox: {
    marginTop: 14,
    backgroundColor: theme.primarySoft,
    borderRadius: theme.radiusSmall,
    padding: 14,
  },
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
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  fullWidth: { flex: 0, marginTop: 4 },
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
  job: {
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  jobHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  jobStatus: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.textMuted,
  },
  jobError: { marginTop: 4, fontSize: 12, color: theme.primary },
  retry: { flex: 0, marginTop: 10, alignSelf: "flex-start", paddingHorizontal: 22 },
});
