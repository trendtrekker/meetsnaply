import { Bell, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isGoogleConfigured } from "@/lib/calendar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarConnections } from "@/components/dashboard/calendar-connections";
import { SettingsForm } from "@/components/dashboard/settings-form";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const user = await requireUser();
  const { calendar } = await searchParams;
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const connections = await db.calendarConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      accountEmail: true,
      calendarId: true,
      checkConflicts: true,
      isDestination: true,
      lastError: true,
      lastSyncedAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Your settings
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          View or edit your app settings.
        </p>
      </header>

      <SettingsForm
        origin={origin}
        values={{
          name: user.name,
          username: user.username,
          bio: user.bio ?? "",
          timeZone: user.timeZone,
        }}
      />

      <div className="mt-5 space-y-3">
        <CalendarConnections
          connections={connections}
          configured={isGoogleConfigured()}
          status={calendar}
        />

        <PendingCard
          icon={<ShieldCheck className="size-4" />}
          title="Permissions"
          description="Microphone and camera permissions for recorded calls, plus recording retention limits."
        />

        <PendingCard
          icon={<Bell className="size-4" />}
          title="Notifications"
          description="Confirmation emails, reminders, and post-meeting recap delivery."
        />
      </div>
    </div>
  );
}

function PendingCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-text-muted">{icon}</span>
            {title}
          </CardTitle>
          <Badge>Not wired up</Badge>
        </div>
      </CardHeader>
      <CardBody className="pt-2">
        <p className="text-sm text-text-muted">{description}</p>
        {children}
      </CardBody>
    </Card>
  );
}
