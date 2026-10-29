import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Config } from "../types";
import { defaultConfig } from "./defaults";

const CONFIG_KEY = "config";
const PASSWORD_KEY = "unilogin-password";

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const password = (await SecureStore.getItemAsync(PASSWORD_KEY)) ?? "";
    return {
      ...defaultConfig,
      ...saved,
      ignored: { ...defaultConfig.ignored, ...saved.ignored },
      password,
    };
  } catch {
    return defaultConfig;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const { password, ...rest } = config;
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(rest));
  if (password) await SecureStore.setItemAsync(PASSWORD_KEY, password);
  else await SecureStore.deleteItemAsync(PASSWORD_KEY);
}
