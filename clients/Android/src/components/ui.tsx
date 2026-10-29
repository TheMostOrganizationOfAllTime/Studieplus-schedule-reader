import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export const colors = {
  bg: "#f4f5f7", card: "#ffffff", text: "#111827", muted: "#6b7280",
  accent: "#2563eb", danger: "#dc2626", border: "#e5e7eb",
};

export const ui = StyleSheet.create({
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 16,
    color: colors.text, backgroundColor: "#fff",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  label: { fontSize: 16, color: colors.text },
  error: { color: colors.danger, marginTop: 4 },
});

export function Section(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.description && <Text style={styles.description}>{props.description}</Text>}
      {props.children}
    </View>
  );
}

type IconName = ComponentProps<typeof Ionicons>["name"];

export function IconButton(props: { name: IconName; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={props.onPress} hitSlop={8} style={styles.iconButton}>
      <Ionicons name={props.name} size={24} color={props.color ?? colors.accent} />
    </Pressable>
  );
}

export function Segmented<T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {props.options.map((o) => {
        const active = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => props.onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={{ color: active ? "#fff" : colors.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 16,
  },
  sectionTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: 4 },
  description: { color: colors.muted, marginBottom: 12 },
  iconButton: { padding: 4 },
  segmented: {
    flexDirection: "row", borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, overflow: "hidden", marginBottom: 8,
  },
  segment: { flex: 1, paddingVertical: 8, alignItems: "center" },
  segmentActive: { backgroundColor: colors.accent },
});