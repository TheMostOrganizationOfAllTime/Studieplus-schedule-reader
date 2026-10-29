import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./ui";

interface Props {
  title: string;
  icon: "eye-outline" | "settings-outline";
  onIconPress: () => void;
}

export function Header({ title, icon, onIconPress }: Props) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <Pressable onPress={onIconPress} hitSlop={12}>
        <Ionicons name={icon} size={26} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.card,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
});