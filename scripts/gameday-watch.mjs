// GitHub runs "every 10 minutes" schedules much less often than asked (often
// once an hour or two), which is too slow for live scores and the reminder
// an hour before puck drop. On game days this script stays awake from about
// 75 minutes before the game until it's over and starts the other workflows
// itself every 5 minutes. Runs started this way aren't delayed by GitHub.
//
// The hourly check that starts this script is delayed too, so it begins
// watching up to 12 hours ahead. A run can only last about 6 hours, so when
// one runs out of time before the game is over it starts the next one itself.
//
// Usage: node scripts/gameday-watch.mjs [--dry]

const TEAM = "MTL";
const NHL = "https://api-web.nhle.com/v1";
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const DRY = process.argv.includes("--dry");
const MIN = 60000;
const TICK = 5 * MIN;
const LEAD = 75 * MIN; // start this long before the game
const MAX_RUN = 340 * MIN; // stay under the 6-hour job limit
const AHEAD = 12 * 60 * MIN; // start watching this long before the game
const AFTER = 5 * 60 * MIN; // give up this long after the start

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (g) => g.gameState === "FINAL" || g.gameState === "OFF";

async function schedule() {
  const res = await fetch(`${NHL}/club-schedule-season/${TEAM}/now`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`schedule: HTTP ${res.status}`);
  return (await res.json()).games || [];
}

// The game worth watching: not over, and starting within 12 hours or already on.
export function pick(games, now) {
  return games.find((g) => {
    const start = Date.parse(g.startTimeUTC);
    return !done(g) && g.gameState !== "PPD" && now > start - AHEAD && now < start + AFTER;
  });
}

async function dispatch(workflow) {
  if (DRY) return console.log(`(dry run) would start ${workflow}`);
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main" }),
  });
  console.log(`${new Date().toISOString()} start ${workflow}: ${res.ok ? "ok" : "HTTP " + res.status}`);
}

async function main() {
  const began = Date.now();
  const game = pick(await schedule(), began);
  if (!game) return console.log("No Habs game in the next 12 hours. Nothing to watch.");

  const start = Date.parse(game.startTimeUTC);
  const gameEnd = start + AFTER;
  const runEnd = began + MAX_RUN;
  console.log(`Watching game ${game.id}, starting ${game.startTimeUTC}.`);

  const handOff = async () => {
    console.log("This run is almost out of time. Starting a fresh one to keep watching.");
    await dispatch("gameday.yml");
  };

  if (Date.now() < start - LEAD) {
    if (start - LEAD > runEnd) {
      await sleep(runEnd - Date.now());
      return handOff();
    }
    await sleep(start - LEAD - Date.now());
  }

  while (Date.now() < Math.min(gameEnd, runEnd)) {
    if (Date.now() < start + 10 * MIN) await dispatch("reminders.yml");
    await dispatch("update.yml");
    if (Date.now() > start) {
      try {
        const now = (await schedule()).find((g) => g.id === game.id);
        if (now && done(now)) {
          console.log("Game over. One last update in 5 minutes, then done.");
          await sleep(TICK);
          await dispatch("update.yml");
          return;
        }
      } catch (err) {
        console.warn(`! couldn't check the score: ${err.message}`);
      }
    }
    await sleep(TICK);
  }
  if (Date.now() < gameEnd) await handOff();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
