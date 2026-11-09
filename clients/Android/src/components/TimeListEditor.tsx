import { useState } from "react";
import { View } from "react-native";
import { TimeField } from "./TimeField";
import { IconButton, colors, ui } from "./ui";

interface Props {
  times: string[]; // "HH:mm"
  onChange: (times: string[]) => void;
}

const tidy = (times: string[]) => [...new Set(times)].sort();

export function TimeListEditor({ times, onChange }: Props) {
  const [draft, setDraft] = useState("16:00");

  return (
    <View>
      {times.map((time, i) => (
        <View key={time} style={ui.row}>
          <View style={{ flex: 1 }}>
            <TimeField
              value={time}
              onChange={(v) => onChange(tidy(times.map((x, j) => (j === i ? v : x))))}
            />
          </View>
          <IconButton
            name="close"
            color={colors.danger}
            onPress={() => onChange(times.filter((_, j) => j !== i))}
          />
        </View>
      ))}
      <View style={ui.row}>
        <View style={{ flex: 1 }}>
          <TimeField value={draft} onChange={setDraft} />
        </View>
        <IconButton name="add-circle" onPress={() => onChange(tidy([...times, draft]))} />
      </View>
    </View>
  );
}