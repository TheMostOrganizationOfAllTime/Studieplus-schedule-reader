import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Header } from "./src/components/Header";
import { ConfigProvider } from "./src/config/ConfigContext";
import { ConfigScreen } from "./src/screens/ConfigScreen";
import { ScheduleScreen } from "./src/screens/ScheduleScreen";

type Screen = "config" | "schedule";

export default function App() {
  const [screen, setScreen] = useState<Screen>("config");

  return (
    <SafeAreaProvider>
      <ConfigProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
          <Header
            title={screen === "config" ? "Alarm settings" : "Tomorrow"}
            icon={screen === "config" ? "eye-outline" : "settings-outline"}
            onIconPress={() => setScreen(screen === "config" ? "schedule" : "config")}
          />
          {screen === "config" ? <ConfigScreen /> : <ScheduleScreen />}
        </SafeAreaView>
        <StatusBar style="dark" />
      </ConfigProvider>
    </SafeAreaProvider>
  );
}