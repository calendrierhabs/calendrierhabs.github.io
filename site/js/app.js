import { STR } from "./i18n.js";
import { team } from "./teams.js";
import * as reminders from "./reminders.js";
import { liveCandidate, fetchLive } from "./live.js";

const US = "MTL";
// Everything is shown in Montréal time, which is also what the TV listings use.
const TZ = "America/Toronto";
const REFRESH_MS = 5 * 60 * 1000;
const LIVE_MS = 20 * 1000;

// ---------- Saved preferences (each device remembers its own) ----------
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  },
};

const TABS = { home: "", cal: "calendrier", stand: "classement", team: "equipe" };
const tabFromHash = () => {
  const h = location.hash.replace("#", "");
  return Object.keys(TABS).find((k) => TABS[k] === h) || "home";
};

const state = {
  lang: store.get("habs.lang") || "fr",
  theme: document.documentElement.dataset.theme || "light",
  tab: tabFromHash(),
  month: null,
  sel: null,
  view: store.get("habs.standView") || "div",
  data: null,
  status: null,
  error: false,
  // Live score for the game on right now, read every few seconds (js/live.js).
  live: null, // { id, patch, at }
};

const app = document.getElementById("app");
const t = () => STR[state.lang];

// ---------- Small helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = (d) => keyFmt.format(d);
const monthKey = (d) => dayKey(d).slice(0, 7);
const fmt = (d, opts) => new Intl.DateTimeFormat(t().locale, { timeZone: TZ, ...opts }).format(d);
// A calendar day as a moment safely inside that day in Montréal.
const noon = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 16));
const keyToDays = (k) => Date.UTC(...k.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 86400000;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = (d) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const longDayLabel = (d) => cap(fmt(d, { weekday: "long", day: "numeric", month: "long" }));

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  stand: '<path d="M6 20V11M12 20V4M18 20v-6"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.6 3 5.2"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// Team logo on its own, the NHL's version for light or dark backgrounds.
// If it can't load (offline, or a team the NHL renamed), the coloured
// initials show instead.
const LOGO = (abbrev, dark) => `https://assets.nhle.com/logos/nhl/svg/${abbrev}_${dark ? "dark" : "light"}.svg`;
const badge = (tm, size = "", dark = state.theme === "rouge") =>
  `<span class="badge logo ${size}${tm.abbrev === US ? " us" : ""}" style="--bg:${tm.bg};--fg:${tm.fg}">${esc(tm.abbrev)}<img src="${LOGO(encodeURIComponent(tm.abbrev), dark)}" style="--z:${tm.z}" alt="" decoding="async" onerror="this.parentNode.classList.remove('logo');this.remove()"></span>`;

// ---------- Turning raw games into what the screens show ----------
function decorate(g) {
  const s = t();
  const date = new Date(g.start);
  const opp = team(g.opp, state.lang, { place: g.oppPlace, name: g.oppName });
  const past = g.state === "FINAL";
  const live = g.state === "LIVE";
  const note = g.last && g.last !== "REG" ? s.note[g.last] : "";
  return {
    ...g,
    date,
    key: dayKey(date),
    team: opp,
    liveInfo: g.live || null,
    past,
    live,
    future: !past && !live,
    short: `${g.home ? "vs" : "@"} ${opp.name}`,
    long: g.home ? s.vsLong(opp.name, opp.city) : s.atLong(opp.name, opp.city),
    time: g.tbd ? s.tbd : fmt(date, { hour: "numeric", minute: "2-digit" }),
    timeShort: g.tbd ? s.tbdShort : fmt(date, { hour: "numeric", minute: "2-digit" }),
    // Channels in the reader's language come first.
    tv: [...(g.tv || [])].sort((x, y) => (y.lang === state.lang) - (x.lang === state.lang)),
    score: g.us != null && g.them != null ? `${g.us}–${g.them}${note ? " " + note : ""}` : "",
    kind: g.type === 1 ? s.preseason : g.type === 3 ? s.playoffs : "",
  };
}

// The data file is the reference, but while it still shows a game as not over,
// the fresher live score is laid over it.
const withLive = (g) => (state.live?.id === g.id && g.state !== "FINAL" ? { ...g, ...state.live.patch } : g);
const allGames = () => (state.data?.games || []).map((g) => decorate(withLive(g))).sort((a, b) => a.date - b.date);

function tvList(g) {
  const s = t();
  if (!g.tv?.length) return `<p class="row-sub" style="margin:0">${s.noTv}</p>`;
  return `<div class="tv-list">${g.tv
    .map(
      (c) =>
        `<span class="tv">${icon("tv")}${esc(c.name)}${c.lang ? `<span class="tag ${c.lang}">${c.lang.toUpperCase()}</span>` : ""}</span>`,
    )
    .join("")}</div>`;
}

function liveLine(g) {
  const s = t();
  const l = g.liveInfo;
  if (!l) return s.live;
  if (l.intermission) return `${s.intermission}`;
  const per = l.periodType === "OT" ? s.ot : l.periodType === "SO" ? s.so : s.period(l.period || 1);
  return l.clock ? `${per} · ${l.clock}` : per;
}

function countdown(date) {
  const s = t();
  const ms = date - Date.now();
  if (ms <= 0) return "";
  const mins = Math.round(ms / 60000);
  if (mins < 24 * 60) return s.inTime(Math.floor(mins / 60), mins % 60);
  return s.inDays(keyToDays(dayKey(date)) - keyToDays(dayKey(new Date())));
}

function whenLabel(g) {
  const s = t();
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(g.date));
  if (g.key === dayKey(today)) return hour >= 17 ? s.tonight : s.today;
  if (g.key === dayKey(tomorrow)) return s.tomorrow;
  return dayLabel(g.date);
}

const usRow = () => (state.data?.standings || []).find((r) => r.abbrev === US);
const divShort = (code) => (t().division[code] || "").replace(/^Division /, "").replace(/ Division$/, "");

function updatedNote() {
  const s = t();
  const checked = state.status?.checkedAt || state.data?.updatedAt;
  const when = state.live && (!checked || state.live.at > Date.parse(checked)) ? state.live.at : checked;
  if (!navigator.onLine) return `<p class="note">${s.offline}</p>`;
  if (!when) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(when)) / 60000));
  return `<p class="note">${s.checked(mins)}</p>`;
}

// ---------- Screens ----------
function viewHome() {
  const s = t();
  const games = allGames();
  const now = Date.now();
  const live = games.find((g) => g.live);
  const upcoming = games.filter((g) => g.future && g.state !== "PPD" && g.date.getTime() > now - 4 * 3600000);
  const hero = live || upcoming[0];
  const recent = games.filter((g) => g.past).slice(-3).reverse();
  const rest = upcoming.filter((g) => g !== hero).slice(0, 3);
  const me = usRow();
  const mtl = team(US, state.lang);

  let heroCard = `<section class="card raised card-pad"><p style="margin:0">${s.noUpcoming}</p></section>`;
  if (hero) {
    const band = hero.live
      ? `<div class="hero-band live"><span class="cond"><span class="live-dot" aria-hidden="true"></span>${s.live}</span><span>${esc(liveLine(hero))}</span></div>`
      : `<div class="hero-band"><span class="cond">${esc(whenLabel(hero))} · ${esc(hero.timeShort)}</span><span>${esc(countdown(hero.date))}</span></div>`;
    const middle = hero.live
      ? `<span class="cond score">${hero.us ?? 0} – ${hero.them ?? 0}</span>`
      : `<span class="cond vs">VS</span>`;
    const left = hero.home ? mtl : hero.team;
    const right = hero.home ? hero.team : mtl;
    const mid = hero.live && !hero.home ? `<span class="cond score">${hero.them ?? 0} – ${hero.us ?? 0}</span>` : middle;
    heroCard = `
      <section class="card raised" aria-label="${esc(whenLabel(hero))}">
        ${band}
        <div class="matchup" style="--left:${left.bg};--right:${right.bg}">
          <div class="side" style="color:${left.fg}">${badge(left, "xl", true)}<span>${esc(left.name)}</span></div>
          ${mid}
          <div class="side" style="color:${right.fg}">${badge(right, "xl", true)}<span>${esc(right.name)}</span></div>
        </div>
        <p class="hero-line">${esc(hero.home ? s.host(hero.team.name) : s.visit(hero.team.name))}</p>
        <p class="hero-sub">${esc(dayLabel(hero.date))}${hero.venue ? " · " + esc(hero.venue) : ""}${hero.kind ? " · " + esc(hero.kind) : ""}</p>
        <div class="hero-watch"><div class="label">${s.watch}</div>${tvList(hero)}</div>
      </section>`;
  }

  const record = me
    ? `<section class="stats3" aria-label="${s.record}">
        <div class="stat"><div class="cond">${me.w}-${me.l}-${me.otl}</div><div>${s.record}</div></div>
        <div class="stat"><div class="cond">${me.pts}</div><div>${s.points}</div></div>
        <div class="stat"><div class="cond">${s.rank(me.divRank)}</div><div>${esc(divShort(me.div))}</div></div>
      </section>`
    : "";

  const recentRows = recent
    .map(
      (g) => `<div class="row">${badge(g.team)}
        <div class="row-main"><div class="row-title">${esc(g.short)}</div><div class="row-sub">${esc(dayLabel(g.date))}</div></div>
        <div class="row-end"><span style="font-weight:600">${esc(g.score)}</span><span class="chip ${g.result}" aria-label="${esc(s.resWord[g.result] || "")}">${esc(s.res[g.result] || "")}</span></div>
      </div>`,
    )
    .join("");

  const nextRows = rest
    .map(
      (g) => `<div class="row">${badge(g.team)}
        <div class="row-main"><div class="row-title">${esc(g.short)}</div><div class="row-sub">${esc(dayLabel(g.date))}${g.tv.length ? " · " + esc(g.tv.map((c) => c.name).join(" · ")) : ""}</div></div>
        <span class="time-pill">${esc(g.timeShort)}</span>
      </div>`,
    )
    .join("");

  return `
    <div class="home-grid">
      <div class="stack">${heroCard}${reminders.card(state.lang)}${record}</div>
      <div class="stack">
        ${recentRows ? `<section class="stack-sm"><h2 class="section-title">${s.last}</h2><div class="card">${recentRows}</div></section>` : ""}
        ${nextRows ? `<section class="stack-sm"><h2 class="section-title">${s.next}</h2><div class="card">${nextRows}</div>
          <button class="link-btn" data-action="tab" data-tab="cal">${s.seeAll}${icon("right")}</button></section>` : ""}
        ${updatedNote()}
      </div>
    </div>`;
}

function seasonMonths(games) {
  if (!games.length) return [monthKey(new Date())];
  let [y, m] = games[0].key.split("-").map(Number);
  const last = games[games.length - 1].key.slice(0, 7);
  const out = [];
  for (let k = `${y}-${pad(m)}`; k <= last; k = `${y}-${pad(m)}`) {
    out.push(k);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

function viewCalendar() {
  const s = t();
  const games = allGames();
  const byDay = Object.fromEntries(games.map((g) => [g.key, g]));
  const months = seasonMonths(games);
  const todayKey = dayKey(new Date());
  if (!state.month || !months.includes(state.month)) {
    const thisMonth = monthKey(new Date());
    state.month = months.includes(thisMonth) ? thisMonth : thisMonth < months[0] ? months[0] : months[months.length - 1];
  }
  const [y, m] = state.month.split("-").map(Number);
  const first = noon(y, m, 1);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const daysIn = new Date(y, m, 0).getDate();
  if (!state.sel || !state.sel.startsWith(state.month)) {
    const firstGame = games.find((g) => g.key.startsWith(state.month));
    state.sel = todayKey.startsWith(state.month) ? todayKey : firstGame ? firstGame.key : `${state.month}-01`;
  }
  const idx = months.indexOf(state.month);

  const dowFmt = (i, opts) => fmt(noon(2026, 1, 4 + i), opts); // Jan 4 2026 is a Sunday
  const head = Array.from({ length: 7 }, (_, i) => {
    const long = dowFmt(i, { weekday: "short" });
    return `<div><span class="short" aria-hidden="true">${esc(long.charAt(0))}</span><span class="long">${esc(long)}</span><span class="sr-only">${esc(long)}</span></div>`;
  }).join("");

  let cells = "";
  for (let i = 0; i < firstDow; i++) cells += `<span class="day blank" aria-hidden="true"></span>`;
  for (let d = 1; d <= daysIn; d++) {
    const key = `${state.month}-${pad(d)}`;
    const g = byDay[key];
    const cls = ["day", g ? (g.past ? "past" : "next") : "", key === todayKey ? "today" : ""].join(" ");
    const sub = g ? (g.past ? g.score : g.live ? s.live : g.timeShort + (g.tv[0] ? " · " + g.tv[0].name : "")) : "";
    const aria = `${longDayLabel(noon(y, m, d))}${g ? ", " + g.long + (g.past ? `, ${s.resWord[g.result] || ""} ${g.score}` : `, ${g.time}`) : ""}`;
    cells += `<button class="${cls}" data-action="sel" data-key="${key}" aria-pressed="${key === state.sel}" aria-label="${esc(aria)}">
      <span class="day-top"><span class="day-num">${d}</span><span class="day-res">${g?.past ? esc(s.res[g.result] || "") : ""}</span></span>
      <span><span class="day-opp" style="display:block">${g ? (g.home ? "" : "@") + esc(g.opp) : ""}</span><span class="day-sub">${esc(sub)}</span></span>
    </button>`;
  }

  const sel = byDay[state.sel];
  const [sy, sm, sd] = state.sel.split("-").map(Number);
  let detail = `<p style="margin:10px 0 0;color:var(--text-2)">${s.noGame}</p>`;
  if (sel) {
    let body = "";
    if (sel.past) {
      body = `<div class="detail-score"><span class="chip ${sel.result}">${esc(s.res[sel.result] || "")}</span><span class="cond">${esc(sel.score)}</span><span class="muted">${esc(s.resWord[sel.result] || "")}</span></div>`;
    } else if (sel.live) {
      body = `<div class="detail-score"><span class="cond">${esc(`${sel.us ?? 0}–${sel.them ?? 0}`)}</span><span class="muted">${esc(liveLine(sel))}</span></div><div style="margin-top:12px">${tvList(sel)}</div>`;
    } else {
      body = `<div style="margin-top:14px;font-weight:700;font-size:18px">${esc(sel.state === "PPD" ? s.postponed : sel.time)}</div><div style="margin-top:10px">${tvList(sel)}</div>`;
    }
    detail = `<div class="detail-head">${badge(sel.team, "lg")}<div class="row-main"><div class="detail-title">${esc(sel.long)}</div>
      <div class="row-sub">${esc(sel.venue || "")}${sel.kind ? " · " + esc(sel.kind) : ""}</div></div></div>${body}`;
  }

  return `
    <div class="cal-layout">
      <section class="card">
        <div class="cal-head">
          <button class="square-btn" data-action="month" data-dir="-1" aria-label="${s.prevMonth}" ${idx <= 0 ? "disabled" : ""}>${icon("left")}</button>
          <h2>${esc(fmt(first, { month: "long", year: "numeric" }))}</h2>
          <button class="square-btn" data-action="month" data-dir="1" aria-label="${s.nextMonth}" ${idx >= months.length - 1 ? "disabled" : ""}>${icon("right")}</button>
        </div>
        <div class="dow">${head}</div>
        <div class="grid">${cells}</div>
        <div class="legend">
          <span><span class="sw next"></span>${s.legendNext}</span>
          <span><span class="sw past"></span>${s.legendPast}</span>
          <span><span class="sw today"></span>${s.today}</span>
          <span style="font-weight:600">${s.legendAway}</span>
        </div>
      </section>
      <section class="card card-pad cal-detail" aria-live="polite">
        <div class="label">${esc(longDayLabel(noon(sy, sm, sd)))}</div>
        ${detail}
      </section>
    </div>`;
}

function viewStandings() {
  const s = t();
  const all = state.data?.standings || [];
  const me = usRow();
  if (!me) return `<p>${s.loadError}</p>`;
  let rows;
  let title;
  let cutAfter = null;
  let marks = false;
  if (state.view === "div") {
    rows = all.filter((r) => r.div === me.div).sort((a, b) => a.divRank - b.divRank);
    title = s.division[me.div];
    cutAfter = 3;
  } else if (state.view === "conf") {
    rows = all.filter((r) => r.conf === me.conf).sort((a, b) => a.confRank - b.confRank);
    title = s.conference[me.conf];
    marks = true;
  } else {
    rows = [...all].sort((a, b) => a.leagueRank - b.leagueRank);
    title = s.league;
  }
  const inPlayoffs = (r) => r.divRank <= 3 || r.wildcard === 1 || r.wildcard === 2;
  const c = s.cols;
  const body = rows
    .map((r, i) => {
      const tm = team(r.abbrev, state.lang, r);
      const cls = [r.abbrev === US ? "us" : "", cutAfter && i + 1 === cutAfter ? "cut" : ""].join(" ");
      return `<tr class="${cls}">
        <td>${i + 1}</td>
        <td class="team"><span class="team-cell">${badge(tm, "sm")}<span class="team-name">${esc(r.abbrev === US ? "Canadiens" : tm.name)}</span>${marks && inPlayoffs(r) ? '<span class="in-dot" aria-hidden="true"></span>' : ""}</span></td>
        <td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td><td>${r.otl}</td>
        <td class="pts">${r.pts}</td>
      </tr>`;
    })
    .join("");
  const btn = (v) => `<button data-action="view" data-view="${v}" aria-pressed="${state.view === v}">${s.views[v]}</button>`;
  const foot =
    state.view === "div"
      ? `<p class="foot"><span class="dash"></span>${s.playoffLine}</p>`
      : state.view === "conf"
        ? `<p class="foot"><span class="in-dot" style="margin:0 8px 0 4px"></span>${s.wildcardLine}</p>`
        : "";
  return `
    <div class="stack stand-wrap">
      <div class="segmented" role="group" aria-label="${esc(s.tabs.stand)}">${btn("div")}${btn("conf")}${btn("league")}</div>
      <section class="card">
        <table class="standings">
          <caption><h2 class="section-title">${esc(title)}</h2></caption>
          <thead><tr><th>#</th><th>${c.team}</th><th>${c.gp}</th><th>${c.w}</th><th>${c.l}</th><th>${c.otl}</th><th>${c.pts}</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </section>
      ${foot}
      ${updatedNote()}
    </div>`;
}

function viewTeam() {
  const s = t();
  const roster = state.data?.roster;
  const stats = state.data?.stats || { skaters: [], goalies: [] };
  if (!roster) return `<p>${s.loadError}</p>`;
  const sk = Object.fromEntries((stats.skaters || []).map((p) => [p.id, p]));
  const gk = Object.fromEntries((stats.goalies || []).map((p) => [p.id, p]));
  const everyone = [...roster.forwards, ...roster.defense, ...roster.goalies];
  const byId = Object.fromEntries(everyone.map((p) => [p.id, p]));
  const lastName = (id) => byId[id]?.last || "";

  const top = (list, key) => list.filter((p) => byId[p.id]).sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))[0];
  const skaters = stats.skaters || [];
  const leaders = [
    [s.lPts, top(skaters, "p"), "p"],
    [s.lG, top(skaters, "g"), "g"],
    [s.lA, top(skaters, "a"), "a"],
    [s.lW, top(stats.goalies || [], "w"), "w"],
  ]
    .filter(([, p]) => p)
    .map(
      ([label, p, key]) =>
        `<div class="leader"><span class="label">${label}</span><span class="cond big">${p[key] ?? 0}</span><span class="who">${esc(lastName(p.id))}</span></div>`,
    )
    .join("");

  const group = (title, players, goalies) => {
    const sorted = [...players].sort((a, b) => {
      const sa = goalies ? gk[a.id]?.gp : sk[a.id]?.p;
      const sb = goalies ? gk[b.id]?.gp : sk[b.id]?.p;
      return (sb ?? -1) - (sa ?? -1) || (a.num ?? 99) - (b.num ?? 99);
    });
    const rows = sorted
      .map((p) => {
        const st = goalies ? gk[p.id] : sk[p.id];
        const line = st ? (goalies ? s.goalieLine(st) : s.skaterLine(st)) : "";
        const pic = p.headshot
          ? `<img class="face" src="${esc(p.headshot)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
          : `<span class="num">${esc(p.num ?? "")}</span>`;
        return `<div class="row">${pic}
          <div class="row-main"><div class="row-title">${esc(p.first)} ${esc(p.last)}</div><div class="row-sub">${p.num != null ? "#" + esc(p.num) + " · " : ""}${esc(s.pos[p.pos] || p.pos)}</div></div>
          <span class="stat-line">${esc(line)}</span></div>`;
      })
      .join("");
    return `<section class="stack-sm"><h2 class="section-title" style="font-size:22px">${title}</h2><div class="card">${rows}</div></section>`;
  };

  return `
    <div class="stack">
      ${leaders ? `<section class="stack-sm"><h2 class="section-title">${s.leaders}</h2><div class="leaders">${leaders}</div></section>` : ""}
      <div class="roster-groups">
        ${group(s.groups.forwards, roster.forwards, false)}
        ${group(s.groups.defense, roster.defense, false)}
        ${group(s.groups.goalies, roster.goalies, true)}
      </div>
      ${updatedNote()}
    </div>`;
}

// ---------- Page frame ----------
function render() {
  const s = t();
  document.documentElement.lang = state.lang;
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "rouge" ? "#2C070C" : "#13194A");
  document.title = `Habs · ${s.tabs[state.tab]}`;

  const tabBtn = (k) =>
    `<button data-action="tab" data-tab="${k}" aria-current="${state.tab === k ? "page" : "false"}">${icon(k)}<span>${s.tabs[k]}</span></button>`;
  const topTab = (k) => `<button data-action="tab" data-tab="${k}" aria-current="${state.tab === k ? "page" : "false"}">${s.tabs[k]}</button>`;
  const dark = state.theme === "rouge";

  let content;
  if (!state.data) {
    content = `<p class="note" style="margin-top:40px">${state.error ? s.loadError : s.loading}</p>`;
  } else {
    content = { home: viewHome, cal: viewCalendar, stand: viewStandings, team: viewTeam }[state.tab]();
  }

  app.innerHTML = `
    <header class="top">
      <div class="top-row">
        <div class="brand">
          ${badge(team(US, state.lang), "brand-badge", true)}
          <div>
            <div class="eyebrow">${s.eyebrow}</div>
            <div class="brand-name">${s.eyebrow}</div>
          </div>
        </div>
        <h1 class="page-title">${s.tabs[state.tab]}</h1>
        <nav class="top-tabs" aria-label="Sections">${Object.keys(TABS).map(topTab).join("")}</nav>
        <div class="controls">
          <button class="round-btn" data-action="theme" aria-label="${dark ? s.themeToLight : s.themeToDark}">${icon(dark ? "sun" : "moon")}</button>
          <div class="lang" role="group" aria-label="${s.langLabel}">
            <button data-action="lang" data-lang="fr" aria-pressed="${state.lang === "fr"}">FR</button>
            <button data-action="lang" data-lang="en" aria-pressed="${state.lang === "en"}">EN</button>
          </div>
        </div>
      </div>
      <div class="stripes" aria-hidden="true"><div></div><div></div><div></div></div>
    </header>
    <main id="main">${content}</main>
    <nav class="bottom-nav" aria-label="Sections">${Object.keys(TABS).map(tabBtn).join("")}</nav>`;
}

// ---------- Interactions ----------
app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  if (a.startsWith("remind")) return reminders.action(a);
  if (a === "tab") {
    const hash = TABS[el.dataset.tab];
    if (tabFromHash() === el.dataset.tab) {
      state.tab = el.dataset.tab;
      render();
    } else {
      location.hash = hash;
    }
    window.scrollTo(0, 0);
    return;
  }
  if (a === "lang") {
    state.lang = el.dataset.lang;
    store.set("habs.lang", state.lang);
    reminders.languageChanged();
  } else if (a === "theme") {
    state.theme = state.theme === "rouge" ? "light" : "rouge";
    store.set("habs.theme", state.theme);
  } else if (a === "sel") {
    state.sel = el.dataset.key;
  } else if (a === "month") {
    const months = seasonMonths(allGames());
    const i = months.indexOf(state.month) + Number(el.dataset.dir);
    if (months[i]) {
      state.month = months[i];
      state.sel = null;
    }
  } else if (a === "view") {
    state.view = el.dataset.view;
    store.set("habs.standView", state.view);
  }
  render();
});

window.addEventListener("hashchange", () => {
  state.tab = tabFromHash();
  render();
});

// ---------- Data ----------
async function load() {
  const first = !state.data;
  try {
    const res = await fetch(`data/habs.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
    state.error = false;
  } catch {
    if (!state.data) state.error = true;
  }
  try {
    const res = await fetch(`data/status.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) state.status = await res.json();
  } catch {}
  render();
  if (first && state.data) liveTick();
}

async function liveTick() {
  if (document.visibilityState !== "visible" || !navigator.onLine) return;
  const game = liveCandidate(state.data?.games);
  if (!game) {
    if (state.live) { state.live = null; render(); }
    return;
  }
  // A final score only needs rechecking now and then until the data file catches up.
  if (state.live?.id === game.id && state.live.patch.state === "FINAL" && Date.now() - state.live.at < 5 * 60 * 1000) return;
  try {
    const patch = await fetchLive(game);
    if (!patch) return;
    const before = JSON.stringify(state.live?.patch);
    state.live = { id: game.id, patch, at: Date.now() };
    if (JSON.stringify(patch) !== before) render();
    // Once it's over, pick up the final stats and standings too.
    if (patch.state === "FINAL" && before && !before.includes('"FINAL"')) load();
  } catch {}
}

reminders.start({ lang: () => state.lang, onChange: render });
render();
load();
setInterval(load, REFRESH_MS);
setInterval(liveTick, LIVE_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load().then(liveTick);
});
window.addEventListener("online", load);
window.addEventListener("offline", render);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
