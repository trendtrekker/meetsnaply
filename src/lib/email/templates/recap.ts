import "server-only";
import { formatDateTime } from "@/lib/datetime";
import {
  bulletSection,
  button,
  footnote,
  header,
  paragraph,
  shell,
} from "./layout";

export interface RecapEmailData {
  recipientName: string;
  hostName: string;
  meetingTitle: string;
  startTime: Date;
  /** Recipient's own zone, so the time reads correctly for them. */
  timeZone: string;
  summary: string;
  decisions: string[];
  actionItems: { text: string; owner: string | null; due: string | null }[];
  openQuestions: string[];
  transcriptUrl: string;
  /** When the audio is scheduled for deletion, if a retention window is set. */
  retentionNote: string | null;
}

function describeActionItem(item: RecapEmailData["actionItems"][number]) {
  const parts = [item.text];
  if (item.owner) parts.push(`— ${item.owner}`);
  if (item.due) parts.push(`(due ${item.due})`);
  return parts.join(" ");
}

export function recapSubject(data: RecapEmailData) {
  return `Recap: ${data.meetingTitle}`;
}

export function recapText(data: RecapEmailData): string {
  const lines: string[] = [
    `${data.meetingTitle}`,
    formatDateTime(data.startTime, data.timeZone),
    "",
    data.summary,
    "",
  ];

  if (data.decisions.length > 0) {
    lines.push("DECISIONS");
    for (const decision of data.decisions) lines.push(`- ${decision}`);
    lines.push("");
  }

  if (data.actionItems.length > 0) {
    lines.push("ACTION ITEMS");
    for (const item of data.actionItems) {
      lines.push(`- ${describeActionItem(item)}`);
    }
    lines.push("");
  }

  if (data.openQuestions.length > 0) {
    lines.push("OPEN QUESTIONS");
    for (const question of data.openQuestions) lines.push(`- ${question}`);
    lines.push("");
  }

  lines.push(`Full transcript: ${data.transcriptUrl}`);
  if (data.retentionNote) lines.push("", data.retentionNote);
  lines.push(
    "",
    "This summary was generated automatically from the meeting recording, which you agreed to when booking. Reply to this email to have the recording and transcript deleted.",
  );

  return lines.join("\n");
}

export function recapHtml(data: RecapEmailData): string {
  return shell({
    preheader: data.summary.slice(0, 140),
    rows: [
      header({
        title: data.meetingTitle,
        subtitle: `${formatDateTime(data.startTime, data.timeZone)} · hosted by ${data.hostName}`,
      }),
      paragraph(data.summary),
      bulletSection("Decisions", data.decisions),
      bulletSection("Action items", data.actionItems.map(describeActionItem)),
      bulletSection("Open questions", data.openQuestions),
      button(data.transcriptUrl, "Read the full transcript"),
      footnote(
        `Generated automatically from the meeting recording, which you agreed to when booking.${
          data.retentionNote ? ` ${data.retentionNote}` : ""
        } Reply to this email to have the recording and transcript deleted.`,
      ),
    ].join(""),
  });
}
