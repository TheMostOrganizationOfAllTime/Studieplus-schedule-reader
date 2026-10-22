# Studie+ schedule fetcher (TypeScript)

Requires Node.js 18.17 or newer (for built-in `fetch` and `AbortSignal.timeout`).

## Setup

1. Put `skema_fetch.ts`, `package.json`, and `tsconfig.json` in the same directory.
2. Run `npm install`.
3. Add `config.json` next to the script with at least `instnr` and `utoken`. Optional keys supported by the script are `strong_name` and `permutation`.
4. Run `npm start -- --help` to see the command options, or for example `npm start -- --weeks 4`.

To type-check without running it, use `npm run typecheck`.

## Importing it from TypeScript

```ts
import { loadConfig, getWeek } from "./skema_fetch";

async function main() {
  const config = await loadConfig();
  const monday = new Date(2026, 10, 9); // local date: 9 November 2026
  const days = await getWeek(config, monday);

  for (const day of days) {
    for (const lesson of day.lessons) {
      console.log(lesson.start, lesson.title, lesson.rooms, lesson.classes);
    }
  }
}

void main();
```

The file/network operations are asynchronous in this version, so `loadConfig`, `fetchWeekText`, and `getWeek` return promises and should be awaited. The HTML entity decoder handles common named entities and numeric entities without adding a runtime dependency.
