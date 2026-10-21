// Live scores straight from the phone, every few seconds during a game.
//
// The site's own data file is refreshed every few minutes by GitHub, which is
// too slow to follow a game. The NHL feed can't be read from a web page (it
// doesn't allow other sites), but ESPN's public scoreboard can, so while a
// Habs game is on the app reads the score from there and lays it over the
// game from the data file. Once the data file has the final score, it wins.

const US = "MTL";
const TZ = "America/Toronto";
const URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard";
const MIN = 60000;

const dateParam = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

// The game worth following right now, if any: from a few minutes before
// puck drop until the data file says it's over.
export function liveCandidate(games, now = Date.now()) {
  return (games || []).find((g) => {
    if (g.state === "FINAL" || g.state === "PPD") return false;
    const start = Date.parse(g.start);
    return now > start - 10 * MIN && now < start + 6 * 60 * MIN;
  });
}

// Turns ESPN's view of the game into the same shape as a game in habs.json.
export function fromEspn(ev, game) {
  const comp = ev?.competitions?.[0];
  const us = comp?.competitors?.find((c) => c.team?.abbreviation === US);
  const them = comp?.competitors?.find((c) => c !== us);
  const st = ev?.status;
  if (!us || !them || !st?.type) return null;
  const state = st.type.state; // pre, in, post
  if (state !== "in" && state !== "post") return null;
  if (state === "post" && !st.type.completed) return null; // postponed or cancelled

  const period = Number(st.period) || 1;
  const detail = `${st.type.shortDetail || ""} ${st.type.altDetail || ""}`;
  const periodType = /\bSO\b/.test(detail) ? "SO" : period <= 3 ? "REG" : game.type === 3 || period === 4 ? "OT" : "SO";
  const patch = { us: Number(us.score) || 0, them: Number(them.score) || 0, last: periodType };
  if (state === "post") {
    patch.state = "FINAL";
    patch.result = patch.us > patch.them ? "W" : periodType === "REG" ? "L" : "OTL";
    patch.live = null;
  } else {
    patch.state = "LIVE";
    patch.live = {
      period,
      periodType,
      clock: periodType === "SO" ? null : st.displayClock || null,
      intermission: st.type.name === "STATUS_END_PERIOD",
    };
  }
  return patch;
}

export async function fetchLive(game) {
  const start = Date.parse(game.start);
  const day = dateParam.format(new Date(start)).replace(/-/g, "");
  const res = await fetch(`${URL}?dates=${day}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const ev = (data.events || []).find(
    (e) =>
      e.competitions?.[0]?.competitors?.some((c) => c.team?.abbreviation === US) &&
      Math.abs(Date.parse(e.date) - start) < 3 * 60 * MIN,
  );
  return ev ? fromEspn(ev, game) : null;
}
