import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";

import { theme } from "@/ui/theme";

type Variant = "primary" | "outline" | "danger";

/**
 * A button that can ask first.
 *
 * `confirm` turns the press into a native alert before anything is sent.
 * Declining a request and cancelling a meeting both send email to a real
 * person the moment they happen, and neither has an undo — so on a phone,
 * where the tap target is a thumb, they ask.
 */
export function ActionButton({
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
  confirm,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
  confirm?: { title: string; message: string; destructive?: boolean };
  style?: ViewStyle;
}) {
  function press() {
    if (busy || disabled) return;
    if (!confirm) return onPress();

    Alert.alert(confirm.title, confirm.message, [
      { text: "Back", style: "cancel" },
      {
        text: "Confirm",
        style: confirm.destructive ? "destructive" : "default",
        onPress,
      },
    ]);
  }

  const inactive = busy || disabled;

  return (
    <Pressable
      onPress={press}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === "primary" ? "#fff" : theme.primary}
          size="small"
        />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    borderRadius: theme.radiusSmall,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  pressed: { opacity: 0.75 },
  inactive: { opacity: 0.5 },
  label: { fontWeight: "800", fontSize: 14 },

  primary: { backgroundColor: theme.primary, borderColor: theme.primary },
  primaryLabel: { color: "#fff" },

  outline: { backgroundColor: theme.surface, borderColor: theme.border },
  outlineLabel: { color: theme.text },

  danger: { backgroundColor: theme.surface, borderColor: theme.primary },
  dangerLabel: { color: theme.primary },
});
