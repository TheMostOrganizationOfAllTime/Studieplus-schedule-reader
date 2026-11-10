import { useEffect, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import {
  attachLoginHost,
  failLogin,
  handleLoginMessage,
  shouldAllowNavigation,
  type HostJob,
} from "../lib/unilogin";

// Set to true to watch the login happen on screen while debugging.
const SHOW_FOR_DEBUGGING = false;

export function UniloginHost() {
  const [job, setJob] = useState<HostJob | null>(null);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    attachLoginHost({
      start: (j) => {
        setRunId((n) => n + 1); // a new key gives a fresh WebView for every job
        setJob(j);
      },
      stop: () => setJob(null),
    });
    return () => attachLoginHost(null);
  }, []);

  if (!job) return null;

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
        source={{ uri: job.uri, headers: { "Cache-Control": "no-cache" } }}
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        setSupportMultipleWindows={false}
        injectedJavaScriptBeforeContentLoaded={job.beforeScript}
        injectedJavaScript={job.script}
        onMessage={(e) => handleLoginMessage(e.nativeEvent.data)}
        onShouldStartLoadWithRequest={(req) => shouldAllowNavigation(req.url)}
        onError={() => failLogin("unreachable")}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 500) failLogin("unreachable");
        }}
      />
    </View>
  );
}