import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from "react";
import type { Config } from "../types";
import { loadConfig, saveConfig } from "./storage";

interface ConfigContextValue {
  config: Config;
  update: (patch: Partial<Config>) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig);
  }, []);

  useEffect(() => {
    if (config) void saveConfig(config);
  }, [config]);

  const update = useCallback((patch: Partial<Config>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  if (!config) return null; // still loading
  return (
    <ConfigContext.Provider value={{ config, update }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used inside ConfigProvider");
  return ctx;
}