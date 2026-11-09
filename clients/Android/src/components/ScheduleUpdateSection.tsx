import { useState } from "react";
import { Text, View } from "react-native";
import { useConfig } from "../config/ConfigContext";
import { updateSchedule } from "../lib/updateSchedule";
import type { ScheduleUpdateSettings } from "../types";
import { TimeField } from "./TimeField";
import { TimeListEditor } from "./TimeListEditor";
import { Button, Section, Segmented, colors, ui } from "./ui";

export function ScheduleUpdateSection() {
  const { config, update } = useConfig();
  const settings = config.scheduleUpdate;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (patch: Partial<ScheduleUpdateSettings>) =>
    update({ scheduleUpdate: { ...settings, ...patch } });

  const requestUpdate = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await updateSchedule(config);
      if (result.utoken !== config.utoken) update({ utoken: result.utoken });
      setStatus({ ok: true, text: `Updated ${result.files.length} weeks` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : "Internal error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Schedule updates"
      description="It also checks your schedule just before waking you"
    >
      <Segmented
        value={settings.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: "times", label: "At times of day" },
          { value: "interval", label: "Every…" },
        ]}
      />
      {settings.mode === "times" ? (
        <TimeListEditor times={settings.times} onChange={(times) => set({ times })} />
      ) : (
        <View style={ui.row}>
          <Text style={ui.label}>Update every (hh:mm)</Text>
          <TimeField
            value={settings.interval}
            onChange={(interval) => interval !== "00:00" && set({ interval })}
          />
        </View>
      )}
      <Button
        title={busy ? "Updating…" : "Request update"}
        onPress={requestUpdate}
        disabled={busy}
      />
      {status && (
        <Text style={status.ok ? { color: colors.accent, marginTop: 8 } : [ui.error, { marginTop: 8 }]}>
          {status.text}
        </Text>
      )}
    </Section>
  );
}