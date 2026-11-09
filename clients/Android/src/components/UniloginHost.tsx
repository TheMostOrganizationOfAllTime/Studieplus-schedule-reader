import { useEffect, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import {
  START_URL,
  attachLoginHost,
  handleLoginMessage,
  isAllowedUrl,
} from "../lib/unilogin";

// Set to true to watch the login happen on screen while debugging.
const SHOW_FOR_DEBUGGING = false;

export function UniloginHost() {
  const [script, setScript] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    attachLoginHost({
      start: (s) => {
        setRunId((n) => n + 1);
        setScript(s);
      },
      stop: () => setScript(null),
    });
    return () => attachLoginHost(null);
  }, []);

  if (!script) return null;

  return (
    <View
      pointerEvents={SHOW_FOR_DEBUGGING ? "auto" : "none"}
      style={
        SHOW_FOR_DEBUGGING
          ? { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }
          : { position: "absolute", left: -10000, top: 0, width: 360, height: 640 }
      }
    >
      <WebView
        key={runId}
        source={{
          uri: START_URL,
          headers: { "Cache-Control": "no-cache" },
        }}
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        setSupportMultipleWindows={false}
        injectedJavaScript={script}
        onMessage={(e) => handleLoginMessage(e.nativeEvent.data)}
        onShouldStartLoadWithRequest={(req) => {
          const ok = isAllowedUrl(req.url);
          console.log(`Unilogin WebView ${ok ? "allow" : "BLOCK"}`, req.url.split("?")[0]);
          return ok;
        }}
      />
    </View>
  );
}