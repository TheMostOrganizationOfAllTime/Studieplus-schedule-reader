import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { IconButton, colors, ui } from "./ui";

interface Props {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  /** Valid values to suggest while typing. Anything else can still be typed in. */
  suggestions?: string[];
}

export function StringListEditor({
  items,
  onChange,
  placeholder,
  suggestions = [],
}: Props) {
  const [draft, setDraft] = useState("");

  const query = draft.trim().toLowerCase();
  const matches = query
    ? suggestions
        .filter((s) => s.toLowerCase().includes(query) && !items.includes(s))
        .sort(
          (a, b) =>
            Number(b.toLowerCase().startsWith(query)) -
            Number(a.toLowerCase().startsWith(query)),
        )
        .slice(0, 6)
    : [];

  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  };
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));

  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={ui.row}>
          <TextInput
            style={[ui.input, { flex: 1 }]}
            value={item}
            onChangeText={(t) => onChange(items.map((x, j) => (j === i ? t : x)))}
            onEndEditing={() => !item.trim() && remove(i)}
          />
          <IconButton name="close" color={colors.danger} onPress={() => remove(i)} />
        </View>
      ))}
      <View style={ui.row}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => add(draft)}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <IconButton name="add-circle" onPress={() => add(draft)} />
      </View>
      {matches.length > 0 && (
        <View style={styles.suggestions}>
          {matches.map((m) => (
            <Pressable key={m} onPress={() => add(m)} style={styles.suggestion}>
              <Text style={ui.label}>{m}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestions: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    overflow: "hidden", marginBottom: 8,
  },
  suggestion: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
});