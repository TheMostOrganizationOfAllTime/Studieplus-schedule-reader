import { useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { confirmLogin } from "../api/auth";
import { ConditionalOffsetEditor } from "../components/ConditionalOffsetEditor";
import { StringListEditor } from "../components/StringListEditor";
import { TimeField } from "../components/TimeField";
import { Section, colors, ui } from "../components/ui";
import { useConfig } from "../config/ConfigContext";
import { hhmmToMinutes, minutesToHhmm } from "../lib/time";

export function ConfigScreen() {
  const { config, update } = useConfig();
  const [loginAttempted, setLoginAttempted] = useState(false);

  const toggleLogin = (next: boolean) => {
    if (!next) {
      update({ useLogin: false });
      return;
    }
    // Only becomes true if the user explicitly confirms.
    Alert.alert(
      "Be careful with your password",
      "You are about to type a password into an app that isn't made by the company that password belongs to. Only continue if you trust this app.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "I understand", onPress: () => update({ useLogin: true }) },
      ],
    );
  };

  const tryLogin = async () => {
    if (!config.username || !config.password) return;
    const token = await confirmLogin(config.username, config.password);
    update({ utoken: token });
    setLoginAttempted(true);
  };

  const loginFailed = loginAttempted && !config.utoken;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Section title="General">
        <View style={ui.row}>
          <Text style={[ui.label, { flex: 1 }]}>Enabled</Text>
          <Switch value={config.enabled} onValueChange={(v) => update({ enabled: v })} />
        </View>
        <View style={ui.row}>
          <Text style={[ui.label, { flex: 1 }]}>Use Unilogin</Text>
          <Switch value={config.useLogin} onValueChange={toggleLogin} />
        </View>
      </Section>

      {config.useLogin ? (
        <Section title="Unilogin">
          <TextInput
            style={[ui.input, { marginBottom: 8 }]}
            placeholder="Username"
            value={config.username}
            onChangeText={(username) => update({ username })}
            onEndEditing={tryLogin}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={ui.input}
            placeholder="Password"
            value={config.password}
            onChangeText={(password) => update({ password })}
            onEndEditing={tryLogin}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          {loginFailed && <Text style={ui.error}>Incorrect username or password</Text>}
        </Section>
      ) : (
        <Section title="Manual input">
          <StringListEditor
            items={config.classes}
            onChange={(classes) => update({ classes })}
            placeholder="Add a class"
          />
        </Section>
      )}

      <Section
        title="Ignored"
        description="Add any rooms, subjects or teachers whose lessons you want to be ignored when determining when to wake you"
      >
        <Text style={ui.label}>Rooms</Text>
        <StringListEditor
          items={config.ignored.rooms}
          onChange={(rooms) => update({ ignored: { ...config.ignored, rooms } })}
          placeholder="Add a room"
        />
        <Text style={ui.label}>Subjects</Text>
        <StringListEditor
          items={config.ignored.subjects}
          onChange={(subjects) => update({ ignored: { ...config.ignored, subjects } })}
          placeholder="Add a subject"
        />
        <Text style={ui.label}>Teachers</Text>
        <StringListEditor
          items={config.ignored.teachers}
          onChange={(teachers) => update({ ignored: { ...config.ignored, teachers } })}
          placeholder="Add a teacher"
        />
      </Section>

      <Section title="Transit Time">
        <Text style={[ui.label, { marginBottom: 4 }]}>Time it takes to get to school (hh:mm)</Text>
        <TimeField
          value={minutesToHhmm(config.base)}
          onChange={(v) => update({ base: hhmmToMinutes(v) })}
        />
        <Text style={[ui.label, { marginTop: 16, marginBottom: 8, fontWeight: "600" }]}>
          Special cases
        </Text>
        <ConditionalOffsetEditor
          value={config.conditionalOffset}
          onChange={(conditionalOffset) => update({ conditionalOffset })}
        />
      </Section>
    </ScrollView>
  );
}