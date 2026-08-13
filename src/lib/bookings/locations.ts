import type { LocationType } from "@/generated/prisma/enums";

export const LOCATION_LABELS: Record<LocationType, string> = {
  MEETSNAPLY_VIDEO: "meetsnaply video",
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  PHONE_HOST_CALLS: "Phone call — host calls you",
  PHONE_INVITEE_CALLS: "Phone call — you call the host",
  IN_PERSON: "In person",
  CUSTOM: "Custom",
};

/** Location types that can carry a recording and therefore a transcript. */
export const RECORDABLE_LOCATIONS: LocationType[] = ["MEETSNAPLY_VIDEO"];

export function isRecordable(locationType: LocationType) {
  return RECORDABLE_LOCATIONS.includes(locationType);
}

/** Human-readable "where", shown on confirmations and in emails. */
export function describeLocation(
  locationType: LocationType,
  locationValue: string | null,
  meetingUrl: string | null,
) {
  switch (locationType) {
    case "IN_PERSON":
      return locationValue ?? "In person";
    case "PHONE_HOST_CALLS":
      return "The host will call you";
    case "PHONE_INVITEE_CALLS":
      return locationValue
        ? `Call the host on ${locationValue}`
        : "You will call the host";
    case "CUSTOM":
      return locationValue ?? "Details to follow";
    default:
      return meetingUrl ?? LOCATION_LABELS[locationType];
  }
}

// Room provisioning lives in src/lib/video — it needs an async provider call,
// which does not belong in this pure module.
