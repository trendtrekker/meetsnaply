import Link from "next/link";
import { AlertTriangle, Check, CalendarSync } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import {
  disconnectCalendar,
  setDestinationCalendar,
  toggleConflictChecking,
} from "@/lib/calendar/actions";

export interface ConnectionView {
  id: string;
  accountEmail: string;
  calendarId: string;
  checkConflicts: boolean;
  isDestination: boolean;
  lastError: string | null;
  lastSyncedAt: Date | null;
}

const STATUS_MESSAGES: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Calendar connected." },
  cancelled: { tone: "bad", text: "You cancelled the Google sign-in." },
  failed: {
    tone: "bad",
    text: "Google sign-in failed. Please try again.",
  },
  "not-configured": {
    tone: "bad",
    text: "Google Calendar isn't configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  },
  "insufficient-scope": {
    tone: "bad",
    text: "meetsnaply needs both calendar permissions to check conflicts and add bookings. Please accept all of them.",
  },
  "no-refresh-token": {
    tone: "bad",
    text: "Google didn't return a refresh token, so the connection couldn't be kept alive. Remove meetsnaply from your Google account permissions and try again.",
  },
};

export function CalendarConnections({
  connections,
  configured,
  status,
}: {
  connections: ConnectionView[];
  configured: boolean;
  status?: string;
}) {
  const message = status ? STATUS_MESSAGES[status] : undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-text-muted">
              <CalendarSync className="size-4" />
            </span>
            Calendar integrations
          </CardTitle>
          {connections.length > 0 ? (
            <Badge tone="success">
              {connections.length} connected
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Events on a connected calendar block your booking slots, and confirmed
          bookings are written back to your destination calendar.
        </p>
      </CardHeader>

      <CardBody className="space-y-4">
        {message ? (
          <p
            role="status"
            className={`rounded-field px-3.5 py-2.5 text-sm font-medium ${
              message.tone === "ok"
                ? "bg-success/10 text-success"
                : "bg-danger/10 text-danger"
            }`}
          >
            {message.text}
          </p>
        ) : null}

        {connections.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border">
            {connections.map((connection) => (
              <li key={connection.id} className="space-y-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {connection.accountEmail}
                    </p>
                    <p className="text-xs text-text-muted">
                      Google Calendar · {connection.calendarId}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {connection.isDestination ? (
                      <Badge tone="brand">Destination</Badge>
                    ) : null}
                    {connection.checkConflicts ? (
                      <Badge tone="success">
                        <Check className="size-3" />
                        Checking conflicts
                      </Badge>
                    ) : (
                      <Badge>Not checking</Badge>
                    )}
                  </div>
                </div>

                {connection.lastError ? (
                  <p className="flex items-start gap-2 rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {connection.lastError} Reconnect the calendar to fix this.
                    </span>
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <form action={toggleConflictChecking}>
                    <input type="hidden" name="id" value={connection.id} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={connection.checkConflicts ? "false" : "true"}
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      {connection.checkConflicts
                        ? "Stop checking conflicts"
                        : "Check conflicts"}
                    </Button>
                  </form>

                  {!connection.isDestination ? (
                    <form action={setDestinationCalendar}>
                      <input type="hidden" name="id" value={connection.id} />
                      <Button type="submit" size="sm" variant="secondary">
                        Write bookings here
                      </Button>
                    </form>
                  ) : null}

                  <form action={disconnectCalendar}>
                    <input type="hidden" name="id" value={connection.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Disconnect
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">
            No calendars connected. Until you connect one, conflicts are only
            checked against bookings made in meetsnaply.
          </p>
        )}

        {configured ? (
          <Link href="/api/calendar/google/connect" prefetch={false}>
            <Button type="button" size="sm">
              {connections.length > 0
                ? "Connect another Google account"
                : "Connect Google Calendar"}
            </Button>
          </Link>
        ) : (
          <p className="rounded-panel bg-surface-muted px-3.5 py-2.5 text-sm text-text-muted">
            Set <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code> in
            your environment to enable Google Calendar. See the README.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
