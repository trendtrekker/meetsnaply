/**
 * The web app's palette, carried across so the two surfaces look like one
 * product. Values read from src/app/globals.css.
 */
export const theme = {
  bg: "#F5F0E8",
  surface: "#FFFFFF",
  border: "#E6DFD3",
  text: "#1A1713",
  textMuted: "#7A7168",
  primary: "#E8502A",
  primarySoft: "#FBE3DC",
  warning: "#B4690E",
  radius: 16,
  radiusSmall: 10,
} as const;

export const statusColor: Record<string, string> = {
  CONFIRMED: "#1F7A46",
  PENDING: "#B4690E",
  CANCELLED: "#7A7168",
  REJECTED: "#7A7168",
};
