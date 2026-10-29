import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { dateToHhmm, hhmmToDate } from "../lib/time";
import { ui } from "./ui";

interface Props {
  value: string; // "HH:mm"
  onChange: (value: string) => void;
}

export function TimeField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const handleChange = (e: DateTimePickerEvent, date?: Date) => {
    setOpen(false);
    if (e.type === "set" && date) onChange(dateToHhmm(date));
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={ui.input}>
        <Text style={ui.label}>{value}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={hhmmToDate(value)}
          mode="time"
          is24Hour
          onChange={handleChange}
        />
      )}
    </>
  );
}