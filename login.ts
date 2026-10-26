import {
  chromium,
  type BrowserContext,
  type Cookie,
  type Page,
} from "playwright";
import fs from "node:fs";
import path from "node:path";
import { ScheduleError } from "./types.ts";

// ───────────────────────── paths & constants ─────────────────────────
const CONFIG_PATH = path.resolve("config.json");
const DEBUG_DIR = path.resolve("debug");
const LOG_FILE = path.join(DEBUG_DIR, "login.log");

const START_URL = "https://all.uddataplus.dk/";
const OVERALL_TIMEOUT_MS = 90_000;
// Default cookies are for AARHUS TECH
const DEFAULT_INSTNR = "281075";

const LOG = true;

// ───────────────────────── config ─────────────────────────
type Config = {
  username: string;
  password: string;
  instnr?: string;
  headless?: boolean; // default true
  utoken?: string;
  [key: string]: unknown;
};

function readConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH))
    throw new ScheduleError(`Missing config file on ${CONFIG_PATH}`);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config;
  if (!cfg.username || !cfg.password)
    throw new ScheduleError("config.json needs both username and password");
  return cfg;
}

function saveConfig(patch: Partial<Config>) {
  const current = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ ...current, ...patch }, null, 2),
  );
}

// ───────────────────────── logging ─────────────────────────
let secrets: string[] = [];
const redact = (s: string) =>
  secrets.reduce((acc, x) => (x ? acc.split(x).join("***") : acc), s);
const mask = (v: string) => `${v.slice(0, 4)}… (${v.length} chars)`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(msg: string) {
  if (!LOG) return;
  const line = redact(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// Query strings hold session codes, so they are dropped from the log.
function short(u: string): string {
  try {
    const x = new URL(u);
    return x.origin + x.pathname + (x.search ? "?…" : "");
  } catch {
    return u;
  }
}

let snapN = 0;
async function snapshot(page: Page, label: string) {
  if (!LOG) return;
  const base = path.join(
    DEBUG_DIR,
    `${String(++snapN).padStart(2, "0")}-${label}`,
  );
  await page
    .screenshot({ path: base + ".png", fullPage: true })
    .catch(() => {});
  await page
    .content()
    .then((h) => fs.writeFileSync(base + ".html", redact(h)))
    .catch(() => {});
  const text = await page
    .locator("body")
    .innerText({ timeout: 2000 })
    .then((t) => t.replace(/\s+/g, " ").slice(0, 500))
    .catch(() => "?");
  const title = await page.title().catch(() => "?");
  log(
    `SNAPSHOT ${path.basename(base)} url=${short(page.url())} title="${title}" text="${text}"`,
  );
}

async function logCookies(context: BrowserContext, label: string) {
  if (!LOG) return;
  const cookies = await context.cookies();
  log(
    `COOKIES (${label}): ` +
      (cookies
        .map(
          (c) =>
            `${c.name}@${c.domain}${c.expires > 0 ? "" : "(session)"}[len ${c.value.length}]`,
        )
        .join(", ") || "none"),
  );
}

// ───────────────────────── page detection ─────────────────────────
type State = "studie-start" | "picker" | "username" | "password" | "unknown";

async function detectState(page: Page): Promise<State> {
  const vis = (sel: string) =>
    page
      .locator(sel)
      .first()
      .isVisible()
      .catch(() => false);
  if (await vis("#unilogin")) return "studie-start"; // Studie+ login page
  if (await vis('button[name="selectedIdp"][value="uni_idp"]')) return "picker"; // broker.unilogin.dk
  if (await vis("input#username")) return "username"; // idp.unilogin.dk, step 1
  if (await vis('input[name="password"]')) return "password"; // idp.unilogin.dk, step 2
  return "unknown";
}

async function findUtoken(
  context: BrowserContext,
): Promise<Cookie | undefined> {
  return (await context.cookies()).find((c) => c.name === "utoken" && c.value);
}

async function waitForChange(
  page: Page,
  context: BrowserContext,
  prevUrl: string,
  prevState: State,
) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    await sleep(300);
    if (await findUtoken(context)) return;
    if (page.url() !== prevUrl) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return;
    }
    if ((await detectState(page)) !== prevState) return;
  }
  log("waitForChange: nothing changed within 20s");
}

// ───────────────────────── the login flow ─────────────────────────
export async function login(
  opts: { headed?: boolean; slowMo?: number } = {},
): Promise<void> {
  fs.rmSync(DEBUG_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const cfg = readConfig();
  secrets = [cfg.password];
  const instnr = cfg.instnr ?? DEFAULT_INSTNR;
  const headless = opts.headed ? false : cfg.headless !== false;

  log(`START headless=${headless} instnr=${instnr} user="${cfg.username}"`);

  const browser = await chromium.launch({ headless, slowMo: opts.slowMo ?? 0 });
  const context = await browser.newContext({ locale: "da-DK" });
  const page = await context.newPage();

  // ── network / browser diagnostics ──
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) log(`NAV ${short(f.url())}`);
  });
  page.on("response", async (res) => {
    try {
      const req = res.request();
      const isDoc = req.resourceType() === "document";
      const loc = res.headers()["location"];
      if (isDoc || res.status() >= 300)
        log(
          `HTTP ${res.status()} ${req.method()} ${short(res.url())}${loc ? " -> " + short(loc) : ""}`,
        );
      const names = (await res.headersArray())
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value.split("=")[0]);
      if (names.length)
        log(
          `  set-cookie [${names.join(", ")}] from ${new URL(res.url()).host}`,
        );
    } catch {}
  });
  page.on("requestfailed", (r) =>
    log(
      `REQ FAILED ${r.method()} ${short(r.url())} ${r.failure()?.errorText ?? ""}`,
    ),
  );
  page.on("pageerror", (e) => log(`PAGE ERROR ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") log(`CONSOLE.ERROR ${m.text().slice(0, 200)}`);
  });

  try {
    await context.addCookies([
      {
        name: "instnr",
        value: instnr,
        domain: "all.uddataplus.dk",
        path: "/",
        secure: true,
        sameSite: "Lax" as const,
      },
    ]);

    await page.goto(START_URL, { waitUntil: "domcontentloaded" });

    const acted: Record<string, number> = {};
    let unknownTicks = 0;
    const deadline = Date.now() + OVERALL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const token = await findUtoken(context);
      if (token) {
        await snapshot(page, "success");
        await logCookies(context, "at success");
        log(
          `UTOKEN found on ${token.domain}: ${mask(token.value)} expires=${token.expires > 0 ? new Date(token.expires * 1000).toISOString() : "session"}`,
        );
        saveConfig({ utoken: token.value });
        log("Saved utoken to config.json");
        return;
      }

      const state = await detectState(page);
      log(`STATE ${state} (${short(page.url())})`);

      if (state === "unknown") {
        unknownTicks++;
        if (unknownTicks === 6) await snapshot(page, "unknown");
        await sleep(1000);
        continue;
      }

      acted[state] = (acted[state] ?? 0) + 1;
      // The password is only ever submitted once, so a wrong password cannot lock the account.
      const limit = state === "password" ? 1 : 2;
      if (acted[state] > limit) {
        await snapshot(page, `stuck-${state}`);
        throw new ScheduleError(
          state === "password"
            ? "Back on the password page after submitting it once: wrong password or a changed page (see the snapshot text above)"
            : `Stuck in state "${state}" (seen ${acted[state]} times)`,
        );
      }

      await snapshot(page, `before-${state}`);
      const prevUrl = page.url();

      switch (state) {
        case "studie-start": {
          await page.waitForLoadState("load").catch(() => {});
          const hidden = page.locator('input[name="instnr"]');
          const before = await hidden.inputValue().catch(() => "?");
          log(`hidden instnr on page = ${before} (want ${instnr})`);
          if (before !== instnr) {
            // String expression: runs in the browser, so no DOM types are needed here.
            await page.evaluate(
              `(() => { const el = document.querySelector('input[name="instnr"]'); if (el) el.value = ${JSON.stringify(instnr)}; })()`,
            );
            log(`forced hidden instnr to ${instnr}`);
          }
          await page
            .locator("#huskmig")
            .setChecked(true, { force: true, timeout: 3000 })
            .catch((e) =>
              log(`could not set "Remember me": ${e.message.split("\n")[0]}`),
            );
          log(
            `Remember me checked = ${await page
              .locator("#huskmig")
              .isChecked()
              .catch(() => "?")}`,
          );
          await page.locator("#unilogin").click(); // "Unilogin og Lokalt login"
          break;
        }
        case "picker":
          await page
            .locator('button[name="selectedIdp"][value="uni_idp"]')
            .click(); // "Unilogin"
          break;
        case "username":
          await page.locator("input#username").fill(cfg.username);
          await page.locator("button.js-cta-submit").click();
          break;
        case "password":
          await page.locator('input[name="password"]').fill(cfg.password);
          await page.locator("button.js-cta-submit").click();
          break;
      }

      log(`ACTION done for ${state}`);
      await waitForChange(page, context, prevUrl, state);
    }

    await snapshot(page, "timeout");
    throw new Error(
      `Timed out after ${OVERALL_TIMEOUT_MS / 1000}s without a utoken cookie`,
    );
  } catch (err) {
    log(`FAILED ${(err as Error).stack ?? err}`);
    await snapshot(page, "failure");
    await logCookies(context, "at failure");
    throw err;
  } finally {
    await browser.close();
    log("Browser closed");
  }
}
