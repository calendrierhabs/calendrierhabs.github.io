// Fetches the Canadiens' schedule, standings, roster and stats from the NHL's
// public API and writes one compact file the app reads: site/data/habs.json.
//
// If an endpoint fails, the previous values for that section are kept, so the
// app never goes blank because the NHL had a bad minute.
//
// Usage:
//   node scripts/update-data.mjs                     # live NHL API
//   node scripts/update-data.mjs --fixtures test/fixtures   # offline test data

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEAM = "MTL";
const API = "https://api-web.nhle.com/v1";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "data", "habs.json");
const STATUS = join(ROOT, "site", "data", "status.json");

const fixturesArg = process.argv.indexOf("--fixtures");
const FIXTURES = fixturesArg > -1 ? join(ROOT, process.argv[fixturesArg + 1]) : null;

// Canadian TV networks as they appear in the NHL feed. Anything not listed is
// passed through with its raw code so a new channel still shows up.
const NETWORKS = [
  [/^RDS2$/i, "RDS2", "fr"],
  [/^RDS/i, "RDS", "fr"],
  [/^TVAS2$/i, "TVA Sports 2", "fr"],
  [/^TVA/i, "TVA Sports", "fr"],
  [/^SN1$/i, "Sportsnet One", "en"],
  [/^SN360$/i, "Sportsnet 360", "en"],
  [/^SNE$/i, "Sportsnet East", "en"],
  [/^SNO$/i, "Sportsnet Ontario", "en"],
  [/^SNP$/i, "Sportsnet Pacific", "en"],
  [/^SNW$/i, "Sportsnet West", "en"],
  [/^SN/i, "Sportsnet", "en"],
  [/^TSN(\d)$/i, (m) => "TSN" + m[1], "en"],
  [/^TSN/i, "TSN", "en"],
  [/^CBC$/i, "CBC", "en"],
  [/^CITY/i, "Citytv", "en"],
  [/^PRIME/i, "Prime Video", "en"],
];

function network(code) {
  for (const [re, label, lang] of NETWORKS) {
    const m = String(code).match(re);
    if (m) return { name: typeof label === "function" ? label(m) : label, lang };
  }
  return { name: String(code), lang: null };
}

async function get(path) {
  if (FIXTURES) {
    const file = join(FIXTURES, path.replace(/\//g, "_") + ".json");
    return JSON.parse(await readFile(file, "utf8"));
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API}/${path}`, {
        headers: { "user-agent": "habs-calendar family app" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw lastErr;
}

const txt = (v) => (v && typeof v === "object" ? v.default ?? Object.values(v)[0] : v) ?? "";
const frTxt = (v) => (v && typeof v === "object" ? v.fr ?? v.default : v) ?? "";

function mapGame(g, live) {
  const home = txt(g.homeTeam?.abbrev) === TEAM;
  const us = home ? g.homeTeam : g.awayTeam;
  const them = home ? g.awayTeam : g.homeTeam;
  const state = g.gameState; // FUT, PRE, LIVE, CRIT, FINAL, OFF, PPD, SUSP
  const done = state === "FINAL" || state === "OFF";
  const inProgress = state === "LIVE" || state === "CRIT";
  const last = g.gameOutcome?.lastPeriodType || g.periodDescriptor?.periodType || "REG";
  let result = null;
  if (done && us?.score != null && them?.score != null) {
    result = us.score > them.score ? "W" : last === "REG" ? "L" : "OTL";
  }
  const tv = (g.tvBroadcasts || [])
    .filter((b) => b.countryCode === "CA")
    .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    .map((b) => network(b.network));
  const seen = new Set();
  const out = {
    id: g.id,
    type: g.gameType, // 1 preseason, 2 regular season, 3 playoffs
    start: g.startTimeUTC,
    tbd: g.gameScheduleState === "TBD",
    state: done ? "FINAL" : inProgress ? "LIVE" : state === "PPD" ? "PPD" : "FUT",
    home,
    opp: txt(them?.abbrev),
    oppPlace: { en: txt(them?.placeName), fr: frTxt(them?.placeName) },
    oppName: { en: txt(them?.commonName), fr: frTxt(them?.commonName) },
    venue: txt(g.venue),
    us: us?.score ?? null,
    them: them?.score ?? null,
    last: done || inProgress ? last : null,
    result,
    tv: tv.filter((t) => (seen.has(t.name) ? false : seen.add(t.name))),
  };
  if (inProgress && live) {
    out.live = {
      period: live.periodDescriptor?.number ?? null,
      periodType: live.periodDescriptor?.periodType ?? "REG",
      clock: live.clock?.timeRemaining ?? null,
      intermission: !!live.clock?.inIntermission,
    };
    const lh = txt(live.homeTeam?.abbrev) === TEAM;
    const lu = lh ? live.homeTeam : live.awayTeam;
    const lt = lh ? live.awayTeam : live.homeTeam;
    if (lu?.score != null) out.us = lu.score;
    if (lt?.score != null) out.them = lt.score;
  }
  return out;
}

function mapStanding(s) {
  return {
    abbrev: txt(s.teamAbbrev),
    place: { en: txt(s.placeName), fr: frTxt(s.placeName) },
    name: { en: txt(s.teamCommonName), fr: frTxt(s.teamCommonName) },
    conf: s.conferenceAbbrev,
    div: s.divisionAbbrev,
    gp: s.gamesPlayed,
    w: s.wins,
    l: s.losses,
    otl: s.otLosses,
    pts: s.points,
    divRank: s.divisionSequence,
    confRank: s.conferenceSequence,
    leagueRank: s.leagueSequence,
    wildcard: s.wildcardSequence,
    streak: s.streakCode ? `${s.streakCode}${s.streakCount}` : null,
    l10: s.l10Wins != null ? `${s.l10Wins}-${s.l10Losses}-${s.l10OtLosses}` : null,
    gf: s.goalFor,
    ga: s.goalAgainst,
  };
}

function mapPlayer(p) {
  return {
    id: p.id,
    num: p.sweaterNumber ?? null,
    first: txt(p.firstName),
    last: txt(p.lastName),
    pos: p.positionCode,
    headshot: p.headshot || null,
  };
}

async function main() {
  let prev = {};
  try {
    prev = JSON.parse(await readFile(OUT, "utf8"));
  } catch {}

  const errors = [];
  const attempt = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      console.warn(`! ${name} failed, keeping previous data: ${err.message}`);
      return prev[name];
    }
  };

  const games = await attempt("games", async () => {
    const sched = await get(`club-schedule-season/${TEAM}/now`);
    const list = sched.games || [];
    if (!list.length) throw new Error("schedule is empty");
    const live = {};
    for (const g of list.filter((g) => g.gameState === "LIVE" || g.gameState === "CRIT")) {
      try {
        live[g.id] = await get(`gamecenter/${g.id}/landing`);
      } catch (err) {
        console.warn(`! live details for ${g.id} failed: ${err.message}`);
      }
    }
    return list.map((g) => mapGame(g, live[g.id]));
  });

  const standings = await attempt("standings", async () => {
    const st = await get("standings/now");
    if (!st.standings?.length) throw new Error("standings are empty");
    return st.standings.map(mapStanding);
  });

  const roster = await attempt("roster", async () => {
    const r = await get(`roster/${TEAM}/current`);
    return {
      forwards: (r.forwards || []).map(mapPlayer),
      defense: (r.defensemen || []).map(mapPlayer),
      goalies: (r.goalies || []).map(mapPlayer),
    };
  });

  const stats = await attempt("stats", async () => {
    const s = await get(`club-stats/${TEAM}/now`);
    return {
      skaters: (s.skaters || []).map((p) => ({
        id: p.playerId,
        gp: p.gamesPlayed,
        g: p.goals,
        a: p.assists,
        p: p.points,
        pm: p.plusMinus,
      })),
      goalies: (s.goalies || []).map((p) => ({
        id: p.playerId,
        gp: p.gamesPlayed,
        w: p.wins,
        l: p.losses,
        otl: p.overtimeLosses,
        gaa: p.goalsAgainstAverage,
        svp: p.savePercentage,
        so: p.shutouts,
      })),
    };
  });

  const data = { team: TEAM, games: games || [], standings: standings || [], roster: roster || null, stats: stats || null };
  const now = new Date().toISOString();

  // Only rewrite habs.json when the content changed, so the repo history
  // stays quiet between games.
  const { updatedAt: _ignored, ...prevContent } = prev;
  const changed = JSON.stringify(prevContent) !== JSON.stringify(data);
  await mkdir(dirname(OUT), { recursive: true });
  if (changed) {
    await writeFile(OUT, JSON.stringify({ updatedAt: now, ...data }) + "\n");
  }
  await writeFile(STATUS, JSON.stringify({ checkedAt: now, ok: errors.length === 0, errors }) + "\n");

  console.log(`${changed ? "Updated" : "No changes"}: ${data.games.length} games, ${data.standings.length} teams.`);
  if (errors.length === 4) {
    console.error("Every NHL request failed.");
    process.exitCode = 1;
  }
}

main();
