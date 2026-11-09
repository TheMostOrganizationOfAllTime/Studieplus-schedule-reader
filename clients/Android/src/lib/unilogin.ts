// In-app replacement for lib/login.ts (Playwright can't run on a phone).
// A hidden WebView drives the Unilogin pages; the utoken (HttpOnly) is read
// from the native cookie store.

import CookieManager from "@preeternal/react-native-cookie-manager";

export const START_URL = "https://all.uddataplus.dk/";
export const DEFAULT_INSTNR = "281075"; // Aarhus Tech, same default as lib/login.ts
const STUDIE_HOST = "all.uddataplus.dk";
const OVERALL_TIMEOUT_MS = 90_000;
const POLL_MS = 500;

// ───────────────────────── results ─────────────────────────

export type LoginFailure =
  | "invalid-username"
  | "invalid-password"
  | "unreachable"
  | "internal";

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: LoginFailure };

export const loginFailureMessage: Record<LoginFailure, string> = {
  "invalid-username": "Incorrect username",
  "invalid-password": "Incorrect password",
  unreachable: "Couldn't reach Studie+ servers",
  internal: "Internal error",
};

// ───────────────────────── navigation rules ─────────────────────────

/** The WebView may only visit Studie+ and Unilogin pages, since credentials get typed into them. */
export function isAllowedUrl(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    const { protocol, hostname } = new URL(url);
    const under = (domain: string) =>
      hostname === domain || hostname.endsWith("." + domain);
    return (
      protocol === "https:" &&
      (under("uddataplus.dk") || under("unilogin.dk") || under("studieplus.dk"))
    );
  } catch {
    return false;
  }
}

/** Decides every navigation of the WebView. Also notices Studie+'s maintenance page. */
export function shouldAllowNavigation(url: string): boolean {
  const shown = url.split("?")[0];
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // not a valid URL, isAllowedUrl will reject it
  }
  if (hostname.endsWith("statushub.io")) {
    console.log("Unilogin WebView: redirected to Studie+'s status page", shown);
    failLogin("unreachable");
    return false;
  }
  const ok = isAllowedUrl(url);
  console.log(`Unilogin WebView ${ok ? "allow" : "BLOCK"}`, shown);
  return ok;
}

// ───────────────────────── the script that runs inside the pages ─────────────────────────

function buildLoginScript(
  username: string,
  password: string,
  instnr: string,
): string {
  return String.raw`
(function () {
  if (window.__uniloginRunning) return;
  window.__uniloginRunning = true;

  var USERNAME = ${JSON.stringify(username)};
  var PASSWORD = ${JSON.stringify(password)};
  var INSTNR = ${JSON.stringify(instnr)};
  var onStudie = location.hostname === ${JSON.stringify(STUDIE_HOST)};
  var started = Date.now();
  var acted = null;

  function send(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function log(text) { send({ type: "log", text: text }); }
  function $(s) { return document.querySelector(s); }
  function visible(el) {
    return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }
  function fill(el, value) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Unilogin marks a rejected username/password with a .form-error group.
  function fieldError() {
    var el = $(".form-group.form-error .form-error-message");
    if (!visible(el)) return null;
    return (el.innerText || "").replace(/\s+/g, " ").trim() || "(no message text)";
  }
  function stop() { clearInterval(timer); }
  function clickLater(el) { setTimeout(function () { el.click(); }, 150); }

  log("page " + location.hostname + location.pathname);

  var timer = setInterval(function () {
    var onPasswordPage = visible($('input[name="password"]'));
    var onCredentialPage = visible($("input#username")) || onPasswordPage;
    var err = fieldError();
    if (err && onCredentialPage) {
      stop();
      send({ type: "rejected", message: err, field: onPasswordPage ? "password" : "username" });
      return;
    }

    if (acted) {
      if (Date.now() - started > 20000) { stop(); send({ type: "stuck", state: acted }); }
      return;
    }

    if (onStudie && visible($("#unilogin"))) {
      // Seeing the Studie+ start page again and again means the login isn't progressing.
      var seen = 0;
      try {
        seen = Number(sessionStorage.getItem("uniloginStudie") || 0);
        sessionStorage.setItem("uniloginStudie", String(seen + 1));
      } catch (e) {}
      if (seen >= 2) { stop(); send({ type: "stuck", state: "studie-start" }); return; }

      acted = "studie-start";
      var hidden = $('input[name="instnr"]');
      if (hidden && hidden.value !== INSTNR) hidden.value = INSTNR;
      var remember = $("#huskmig");
      if (remember && !remember.checked) {
        remember.checked = true;
        remember.dispatchEvent(new Event("change", { bubbles: true }));
      }
      var btn = $("#unilogin");
      log("studie-start: clicking <" + btn.tagName.toLowerCase() + "> type=" + btn.type);
      clickLater(btn);
    } else if (visible($('button[name="selectedIdp"][value="uni_idp"]'))) {
      acted = "picker";
      log("picker");
      clickLater($('button[name="selectedIdp"][value="uni_idp"]'));
    } else if (visible($("input#username"))) {
      acted = "username";
      log("username");
      fill($("input#username"), USERNAME);
      clickLater($("button.js-cta-submit"));
    } else if (onPasswordPage) {
      // The password is only ever submitted once, so a wrong password cannot lock the account.
      var already = false;
      try { already = !!sessionStorage.getItem("uniloginPwSent"); } catch (e) {}
      if (already) { stop(); send({ type: "stuck", state: "password" }); return; }
      try { sessionStorage.setItem("uniloginPwSent", "1"); } catch (e) {}
      acted = "password";
      log("password");
      fill($('input[name="password"]'), PASSWORD);
      clickLater($("button.js-cta-submit"));
    }
  }, 500);
})();
true;
`;
}

// ───────────────────────── the login function ─────────────────────────

/** Implemented by <UniloginHost/>, which owns the hidden WebView. */
export interface LoginHost {
  start: (script: string) => void;
  stop: () => void;
}

let host: LoginHost | null = null;
let finishCurrent: ((result: LoginResult) => void) | null = null;

export function attachLoginHost(h: LoginHost | null): void {
  host = h;
}

/** Ends the running login attempt (if any) with a failure. */
export function failLogin(reason: LoginFailure): void {
  finishCurrent?.({ ok: false, reason });
}

async function readUtoken(): Promise<string | null> {
  const cookies = await CookieManager.get(START_URL);
  return cookies["utoken"]?.value || null;
}

/** Logs in through Unilogin. Never throws: failures come back as { ok: false, reason }. */
export async function login(
  username: string,
  password: string,
  instnr: string = DEFAULT_INSTNR,
): Promise<LoginResult> {
  if (!host) return { ok: false, reason: "internal" };
  const currentHost = host;
  failLogin("internal"); // cancel an earlier attempt that is still running

  try {
    // Start from a clean slate (like Playwright's fresh context), then set instnr like lib/login.ts.
    await CookieManager.clearAll();
    await CookieManager.set(START_URL, {
      name: "instnr",
      value: instnr,
      domain: STUDIE_HOST,
      path: "/",
      secure: true,
    });
  } catch (e) {
    console.warn("Unilogin: could not prepare cookies", e);
    return { ok: false, reason: "internal" };
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (result: LoginResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      finishCurrent = null;
      currentHost.stop();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, reason: "unreachable" }), // took far too long
      OVERALL_TIMEOUT_MS,
    );
    const poll = setInterval(async () => {
      try {
        const token = await readUtoken();
        if (token) finish({ ok: true, token });
      } catch {
        // try again on the next tick
      }
    }, POLL_MS);
    finishCurrent = finish;
    currentHost.start(buildLoginScript(username, password, instnr));
  });
}

/** Called by <UniloginHost/> for every message the script sends. */
export function handleLoginMessage(raw: string): void {
  let msg: {
    type?: string;
    message?: string;
    state?: string;
    text?: string;
    field?: string;
  };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  switch (msg.type) {
    case "log":
      console.log(`[unilogin page] ${msg.text}`);
      break;
    case "rejected":
      console.log(`Unilogin rejected the ${msg.field}: ${msg.message}`);
      failLogin(
        msg.field === "password" ? "invalid-password" : "invalid-username",
      );
      break;
    case "stuck":
      console.log(`Unilogin login got stuck in state "${msg.state}"`);
      failLogin("internal");
      break;
  }
}
