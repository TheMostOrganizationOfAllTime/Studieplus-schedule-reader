import { useState } from "react";
import { TextInput, View } from "react-native";
import { IconButton, colors, ui } from "./ui";

interface Props {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}

export function StringListEditor({ items, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
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
          onSubmitEditing={add}
          placeholder={placeholder}
        />
        <IconButton name="add-circle" onPress={add} />
      </View>
    </View>
  );
}