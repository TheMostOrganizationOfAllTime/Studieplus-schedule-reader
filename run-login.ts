import { login } from "./login.ts";

const args = process.argv.slice(2);

// npm run login -- --log
await login({
  headed: args.includes("--headed"),
  slowMo: args.includes("--slow") ? 400 : 0,
  log: args.includes("--log"),
});
// details are already in debug/login.log
