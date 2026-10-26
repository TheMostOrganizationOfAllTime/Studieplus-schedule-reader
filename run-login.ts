import { login } from "./login.ts";

const args = process.argv.slice(2);

await login({
  headed: args.includes("--headed"),
  slowMo: args.includes("--slow") ? 400 : 0,
});
// details are already in debug/login.log
console.log("test");
