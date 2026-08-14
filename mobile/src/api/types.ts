/**
 * The shapes `/api/v1` returns, mirrored by hand.
 *
 * The server's definitions live in src/lib/api/contracts.ts; this is a copy,
 * because `mobile` is a separate package and reaching across would mean either
 * an npm workspace or Metro `watchFolders`, neither of which is worth the risk
 * to the Vercel build yet. When the drift starts to bite, that is the fix.
 *
 * Only the fields the app actually reads are declared. A response carrying more
 * is fine; declaring fields nobody renders is how a mirror rots unnoticed.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  timeZone: string;
  brandColor: string | null;
}

export interface SessionResponse {
  token: string;
  user: User;
}

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "REJECTED";

export interface Attendee {
  id: string;
  name: string;
  email: string;
  isGuest: boolean;
}

export interface BookingSummary {
  id: string;
  uid: string;
  title: string;
  status: BookingStatus;
  /** ISO 8601. Dates cross the wire as strings. */
  startTime: string;
  endTime: string;
  timeZone: string;
  meetingUrl: string | null;
  eventType: { title: string; transcriptionEnabled: boolean };
  attendees: Attendee[];
  recap: { id: string; sentAt: string | null } | null;
}

export interface BookingAnswer {
  id: string;
  label: string;
  value: string;
}

export interface BookingDetail extends BookingSummary {
  description: string | null;
  locationType: string;
  locationValue: string | null;
  cancelReason: string | null;
  answers: BookingAnswer[];
  recording: { id: string; status: string } | null;
}

export interface PipelineJob {
  id: string;
  type: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  completedAt: string | null;
}

export type BookingTab = "upcoming" | "unconfirmed" | "past" | "cancelled";

export interface DashboardResponse {
  user: User;
  upcoming: BookingSummary[];
  unconfirmedCount: number;
}

export interface BookingsResponse {
  tab: BookingTab;
  bookings: BookingSummary[];
}

export interface BookingDetailResponse {
  booking: BookingDetail;
  jobs: PipelineJob[];
}
