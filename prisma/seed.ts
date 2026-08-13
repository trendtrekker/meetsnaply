import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_EMAIL = "damir@meetsnaply.dev";
const DEMO_PASSWORD = "meetsnaply";

/** Next occurrence of `hour:00` UTC, `daysAhead` from today. */
function upcoming(daysAhead: number, hour: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function main() {
  // Idempotent: wipe the demo user and rebuild. Cascades clear the rest.
  await db.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      name: "Damir Ciao",
      username: "damir",
      bio: "Product engineer. Book a slot and you'll get the recap before you're back at your desk.",
      timeZone: "Europe/Berlin",
    },
  });

  const schedule = await db.schedule.create({
    data: {
      userId: user.id,
      name: "Working hours",
      timeZone: "Europe/Berlin",
      isDefault: true,
      rules: {
        create: [
          // Mon–Fri 09:00–13:00 and 14:00–17:30, i.e. a real lunch break.
          ...[1, 2, 3, 4, 5].flatMap((weekday) => [
            { weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
            { weekday, startMinute: 14 * 60, endMinute: 17 * 60 + 30 },
          ]),
          // Saturday mornings only.
          { weekday: 6, startMinute: 10 * 60, endMinute: 12 * 60 },
        ],
      },
    },
  });

  const intro = await db.eventType.create({
    data: {
      userId: user.id,
      scheduleId: schedule.id,
      slug: "intro-call",
      title: "Intro call",
      description: "Fifteen minutes to work out whether we should talk properly.",
      durationMinutes: 15,
      slotIntervalMinutes: 15,
      minimumNoticeMinutes: 120,
      position: 0,
      questions: {
        create: [
          {
            identifier: "topic",
            label: "What would you like to talk about?",
            type: "TEXTAREA",
            required: true,
            position: 0,
          },
          {
            identifier: "source",
            label: "How did you find me?",
            type: "SELECT",
            options: ["A colleague", "Search", "Social", "Somewhere else"],
            position: 1,
          },
        ],
      },
    },
  });

  const devMeeting = await db.eventType.create({
    data: {
      userId: user.id,
      scheduleId: schedule.id,
      slug: "dev-meeting",
      title: "Dev Meeting",
      description:
        "A working session, recorded and transcribed. Everyone gets the recap by email afterwards.",
      durationMinutes: 60,
      slotIntervalMinutes: 30,
      bufferAfterMinutes: 15,
      minimumNoticeMinutes: 240,
      recordingEnabled: true,
      transcriptionEnabled: true,
      sendRecapToAttendees: true,
      position: 1,
    },
  });

  await db.eventType.create({
    data: {
      userId: user.id,
      scheduleId: schedule.id,
      slug: "office-hours",
      title: "Office hours",
      description: "Open slot. Bring anything.",
      durationMinutes: 30,
      requiresConfirmation: true,
      maxBookingsPerDay: 2,
      position: 2,
    },
  });

  // --- A confirmed meeting in the future ---------------------------------
  const upcomingStart = upcoming(3, 9);
  await db.booking.create({
    data: {
      uid: "demo-upcoming",
      eventTypeId: devMeeting.id,
      hostId: user.id,
      title: "Dev Meeting between Damir Ciao and David Charles",
      description: "App update release date",
      startTime: upcomingStart,
      endTime: new Date(upcomingStart.getTime() + 60 * 60_000),
      timeZone: "Europe/Berlin",
      status: "CONFIRMED",
      locationType: "MEETSNAPLY_VIDEO",
      meetingUrl: "http://localhost:3000/call/demo-upcoming",
      attendees: {
        create: [
          {
            name: "David Charles",
            email: "david@meetsnaply.dev",
            timeZone: "Europe/London",
            status: "NEEDS_ACTION",
            recordingConsentAt: new Date(),
          },
        ],
      },
      recording: {
        create: { provider: "meetsnaply", status: "SCHEDULED" },
      },
    },
  });

  // --- A pending request awaiting approval -------------------------------
  const pendingStart = upcoming(5, 14);
  await db.booking.create({
    data: {
      uid: "demo-pending",
      eventTypeId: intro.id,
      hostId: user.id,
      title: "Intro call between Damir Ciao and Lena Fischer",
      startTime: pendingStart,
      endTime: new Date(pendingStart.getTime() + 15 * 60_000),
      timeZone: "America/New_York",
      status: "PENDING",
      locationType: "MEETSNAPLY_VIDEO",
      attendees: {
        create: [
          {
            name: "Lena Fischer",
            email: "lena@example.com",
            timeZone: "America/New_York",
            status: "ACCEPTED",
          },
        ],
      },
      answers: {
        create: [
          {
            label: "What would you like to talk about?",
            value: "Scoping the Q4 integration work.",
          },
        ],
      },
    },
  });

  // --- A past meeting with a full transcript and recap --------------------
  const pastStart = upcoming(-4, 10);
  const past = await db.booking.create({
    data: {
      uid: "demo-past",
      eventTypeId: devMeeting.id,
      hostId: user.id,
      title: "Dev Meeting between Damir Ciao and David Charles",
      description: "App update release date",
      startTime: pastStart,
      endTime: new Date(pastStart.getTime() + 60 * 60_000),
      timeZone: "Europe/Berlin",
      status: "CONFIRMED",
      locationType: "MEETSNAPLY_VIDEO",
      meetingUrl: "http://localhost:3000/call/demo-past",
      attendees: {
        create: [
          {
            name: "David Charles",
            email: "david@meetsnaply.dev",
            timeZone: "Europe/London",
            status: "ACCEPTED",
            recordingConsentAt: pastStart,
          },
        ],
      },
    },
  });

  const recording = await db.meetingRecording.create({
    data: {
      bookingId: past.id,
      provider: "meetsnaply",
      status: "READY",
      durationSeconds: 3480,
      audioUrl: "https://example.invalid/recordings/demo-past.m4a",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  const segments = [
    ["Damir", "Right, let's start with where the 5.3 release actually stands."],
    ["David", "Backend's done. The migration ran on staging Tuesday, no drift."],
    ["Damir", "And the client work?"],
    ["David", "Two screens left. I'd rather cut the settings redesign than slip."],
    ["Damir", "Agreed, cut it. Ship 5.3 without the redesign on the 14th."],
    ["David", "I'll write the release notes and get QA a build by Thursday."],
    ["Damir", "I'll handle the customer comms once QA signs off."],
  ];

  await db.transcript.create({
    data: {
      recordingId: recording.id,
      status: "READY",
      provider: "deepgram",
      language: "en",
      fullText: segments.map(([who, what]) => `${who}: ${what}`).join("\n"),
      segments: {
        create: segments.map(([speaker, text], index) => ({
          speaker,
          startMs: index * 45_000,
          endMs: index * 45_000 + 40_000,
          text,
          confidence: 0.94,
        })),
      },
    },
  });

  await db.meetingRecap.create({
    data: {
      bookingId: past.id,
      model: "claude-opus-5",
      summary:
        "Release 5.3 is on track for the 14th. Backend and migrations are complete and verified on staging. Two client screens remain; the settings redesign is being cut to protect the date.",
      decisions: [
        "Ship 5.3 on the 14th without the settings redesign.",
        "Settings redesign moves to 5.4.",
      ],
      actionItems: [
        { text: "Write release notes", owner: "David", due: "Thursday" },
        { text: "Get QA a build", owner: "David", due: "Thursday" },
        { text: "Send customer comms after QA sign-off", owner: "Damir" },
      ],
      sentAt: new Date(pastStart.getTime() + 70 * 60_000),
    },
  });

  console.log(`Seeded ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("Public page: http://localhost:3000/damir");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
