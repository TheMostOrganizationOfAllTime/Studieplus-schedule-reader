import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { describeCondition, describeOffset, encodeOffset, type Offset } from "../lib/offsets";
import { TimeField } from "./TimeField";
import { IconButton, Segmented, colors, ui } from "./ui";

interface Props {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

export function ConditionalOffsetEditor({ value, onChange }: Props) {
  const [condition, setCondition] = useState<"at" | "range">("range");
  const [from, setFrom] = useState("08:00");
  const [to, setTo] = useState("09:00");
  const [action, setAction] = useState<"before" | "at">("before");
  const [minutes, setMinutes] = useState("60");
  const [wakeAt, setWakeAt] = useState("06:30");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    if (condition === "range" && from >= to) {
      setError("The range must end after it starts");
      return;
    }
    let offset: Offset;
    if (action === "before") {
      const n = Number(minutes);
      if (!Number.isInteger(n) || n < 0) {
        setError("Enter a whole number of minutes");
        return;
      }
      offset = { kind: "before", minutes: n };
    } else {
      offset = { kind: "at", time: wakeAt };
    }
    setError(null);
    const key = condition === "range" ? `${from}-${to}` : from;
    onChange({ ...value, [key]: encodeOffset(offset) });
  };

  const remove = (key: string) => {
    const { [key]: _removed, ...rest } = value;
    onChange(rest);
  };

  return (
    <View>
      {Object.entries(value).sort().map(([key, val]) => (
        <View key={key} style={ui.row}>
          <Text style={[ui.label, { flex: 1 }]}>
            {describeCondition(key)}: {describeOffset(val)}
          </Text>
          <IconButton name="close" color={colors.danger} onPress={() => remove(key)} />
        </View>
      ))}

      <Text style={[ui.label, { marginTop: 8, marginBottom: 4 }]}>If the first lesson starts…</Text>
      <Segmented
        value={condition}
        onChange={setCondition}
        options={[
          { value: "at", label: "At a time" },
          { value: "range", label: "Within a range" },
        ]}
      />
      <View style={ui.row}>
        <TimeField value={from} onChange={setFrom} />
        {condition === "range" && (
          <>
            <Text style={ui.label}>to</Text>
            <TimeField value={to} onChange={setTo} />
          </>
        )}
      </View>

      <Text style={[ui.label, { marginBottom: 4 }]}>…wake me</Text>
      <Segmented
        value={action}
        onChange={setAction}
        options={[
          { value: "before", label: "X min before" },
          { value: "at", label: "At a time" },
        ]}
      />
      <View style={ui.row}>
        {action === "before" ? (
          <>
            <TextInput
              style={[ui.input, { width: 80 }]}
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
            />
            <Text style={ui.label}>minutes before</Text>
          </>
        ) : (
          <TimeField value={wakeAt} onChange={setWakeAt} />
        )}
        <View style={{ flex: 1 }} />
        <IconButton name="add-circle" onPress={add} />
      </View>
      {error && <Text style={ui.error}>{error}</Text>}
    </View>
  );
}