import { useCallback, useEffect, useState, useRef } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { hhmmToMinutes, minutesToHhmm } from "../../../../lib/times";
import { confirmLogin } from "../api/auth";
import { pingServer, syncLists } from "../api/server";
import { ConditionalOffsetEditor } from "../components/ConditionalOffsetEditor";
import { StringListEditor } from "../components/StringListEditor";
import { TimeField } from "../components/TimeField";
import { Section, colors, ui } from "../components/ui";
import { useConfig } from "../config/ConfigContext";
import { loadLists, type Lists } from "../config/lists";

export function ConfigScreen() {
  const { config, update } = useConfig();
  const [loginAttempted, setLoginAttempted] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [suggestions, setSuggestions] = useState<Lists>({
    teachers: [],
    rooms: [],
    classes: [],
  });

  // Show whatever lists were saved last time.
  useEffect(() => {
    loadLists().then(setSuggestions);
  }, []);

  const checkServer = useCallback(async (url: string) => {
    if (!url.trim()) {
      setServerDown(false);
      return;
    }
    if (!(await pingServer(url))) {
      setServerDown(true);
      return;
    }
    setServerDown(false);
    const fresh = await syncLists(url);
    setSuggestions((prev) => ({ ...prev, ...fresh }));
  }, []);

  // Check once on start and whenever the user switches back to manual input.
  useEffect(() => {
    if (!config.useLogin) void checkServer(config.url);
  }, [config.useLogin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everything below "Manual input / Unilogin" stays hidden until this is true.
  const setupDone = config.useLogin
    ? !!config.utoken
    : config.url.trim() !== "" && config.classes.length > 0;

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

  const loggingIn = useRef(false);
  const [loginBusy, setLoginBusy] = useState(false);

  const tryLogin = async () => {
    if (loggingIn.current || !config.username || !config.password) return;
    loggingIn.current = true;
    setLoginBusy(true);
    try {
      const token = await confirmLogin(config.username, config.password);
      update({ utoken: token });
      setLoginAttempted(true);
    } finally {
      loggingIn.current = false;
      setLoginBusy(false);
    }
  };

  const loginFailed = loginAttempted && !config.utoken;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Section title="General">
        {setupDone && (
          <View style={ui.row}>
            <Text style={[ui.label, { flex: 1 }]}>Enabled</Text>
            <Switch value={config.enabled} onValueChange={(v) => update({ enabled: v })} />
          </View>
        )}
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
          {loginBusy && <Text style={[ui.label, { marginTop: 4 }]}>Logging in…</Text>}
          {loginFailed && !loginBusy && (
            <Text style={ui.error}>Incorrect username or password</Text>
          )}
        </Section>
      ) : (
        <Section title="Manual input">
          <Text style={[ui.label, { marginBottom: 4 }]}>URL</Text>
          <TextInput
            style={ui.input}
            placeholder="URL"
            value={config.url}
            onChangeText={(url) => update({ url })}
            onEndEditing={() => checkServer(config.url)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {serverDown && <Text style={ui.error}>Server inaccessible</Text>}
          <Text style={[ui.label, { marginTop: 16, marginBottom: 4 }]}>Classes</Text>
          <StringListEditor
            items={config.classes}
            onChange={(classes) => update({ classes })}
            placeholder="Add a class"
            suggestions={suggestions.classes}
          />
        </Section>
      )}

      {setupDone && (
        <>
          <Section
            title="Ignored"
            description="Add any rooms, subjects or teachers whose lessons you want to be ignored when determining when to wake you"
          >
            <Text style={ui.label}>Rooms</Text>
            <StringListEditor
              items={config.ignored.rooms}
              onChange={(rooms) => update({ ignored: { ...config.ignored, rooms } })}
              placeholder="Add a room"
              suggestions={suggestions.rooms}
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
              suggestions={suggestions.teachers}
            />
          </Section>

          <Section title="Transit Time">
            <Text style={[ui.label, { marginBottom: 4 }]}>
              Time it takes to get to school (hh:mm)
            </Text>
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
        </>
      )}
    </ScrollView>
  );
}