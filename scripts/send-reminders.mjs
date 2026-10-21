// Sends game-day reminders: a push notification to every signed-up device
// about 1 hour before each Canadiens game, in that device's language.
//
// How devices sign up without a server: the app drops an encrypted message in
// a private ntfy.sh mailbox (see site/js/reminders.js). Each run reads the
// mailbox, keeps the list of devices encrypted in reminders/state.json, and
// sends whatever is due. Everything secret lives in the REMINDERS_SECRET
// repo secret.
//
// Usage:
//   node scripts/send-reminders.mjs          # normal run (every 10 min on GitHub)
//   node scripts/send-reminders.mjs --test   # send a test notification to every device now
//   node scripts/send-reminders.mjs keys     # make a new REMINDERS_SECRET (and public keys)
//
// For local runs: --dry-run (send nothing), --now <ISO time>,
// --mailbox-file <file> (read the mailbox from a saved file instead of ntfy.sh).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "site", "data", "habs.json");
const CLIENT = join(ROOT, "site", "js", "reminders.js");
const STATE = join(ROOT, "reminders", "state.json");
const TZ = "America/Toronto";
const LEAD_MIN = 60;
const MAX_DEVICES = 25;
const SITE = "https://calendrierhabs.github.io/";

// Only real browser push services, so a bogus sign-up can't make us call
// some other address.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const DRY = flag("--dry-run");
const NOW = opt("--now") ? new Date(opt("--now")).getTime() : Date.now();

const { subtle } = webcrypto;
const b64 = {
  enc: (buf) => Buffer.from(buf).toString("base64url"),
  dec: (s) => new Uint8Array(Buffer.from(s, "base64url")),
};
const short = (endpoint) => createHash("sha256").update(endpoint).digest("hex").slice(0, 10);

// ---------- Notification text ----------
const TEXT = {
  fr: {
    locale: "fr-CA",
    title: (m) => (m >= 55 ? "Le match commence dans 1 heure" : `Le match commence dans ${m} min`),
    host: (n, at) => `Les Canadiens reçoivent les ${n} à ${at}.`,
    visit: (n, at) => `Les Canadiens rendent visite aux ${n} à ${at}.`,
    tv: (list) => `À la télé : ${list}`,
    noTv: "Chaînes à confirmer",
    testTitle: "Test des rappels",
    testBody: "Tout fonctionne ! Vous recevrez un rappel 1 heure avant chaque match.",
  },
  en: {
    locale: "en-CA",
    title: (m) => (m >= 55 ? "Game starts in 1 hour" : `Game starts in ${m} min`),
    host: (n, at) => `The Canadiens host the ${n} at ${at}.`,
    visit: (n, at) => `The Canadiens visit the ${n} at ${at}.`,
    tv: (list) => `On TV: ${list}`,
    noTv: "Channels to be confirmed",
    testTitle: "Reminder test",
    testBody: "Everything works! You'll get a reminder 1 hour before every game.",
  },
};

function reminder(g, lang) {
  const s = TEXT[lang];
  const at = new Intl.DateTimeFormat(s.locale, { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(g.start));
  const name = g.oppName?.[lang] || g.oppName?.en || g.opp;
  const mins = Math.max(5, Math.round((new Date(g.start) - NOW) / 60000 / 5) * 5);
  // Channels in the reader's language first, then the others.
  const tv = [...(g.tv || [])].sort((a, b) => (b.lang === lang) - (a.lang === lang)).map((c) => c.name);
  return {
    title: s.title(mins),
    body: `${g.home ? s.host(name, at) : s.visit(name, at)}\n${tv.length ? s.tv(tv.join(" · ")) : s.noTv}`,
    tag: `game-${g.id}`,
    lang,
    url: "./",
    ts: new Date(g.start).getTime(),
  };
}

// ---------- Secret and storage ----------
function readSecret() {
  const raw = process.env.REMINDERS_SECRET;
  if (!raw) return null;
  const s = JSON.parse(raw);
  if (!s.vapid?.publicKey || !s.vapid?.privateKey || !s.mailbox?.d || !s.store) throw new Error("REMINDERS_SECRET is incomplete");
  return s;
}

async function storeKey(secret) {
  return subtle.importKey("raw", b64.dec(secret.store), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function loadState(secret) {
  let file = { v: 1, devices: null, sent: {} };
  try {
    file = JSON.parse(await readFile(STATE, "utf8"));
  } catch {}
  let inner = { subs: {}, gone: {} };
  if (file.devices) {
    const [iv, ct] = file.devices.split(".").map(b64.dec);
    const pt = await subtle.decrypt({ name: "AES-GCM", iv }, await storeKey(secret), ct);
    inner = JSON.parse(new TextDecoder().decode(pt));
  }
  return { subs: inner.subs || {}, gone: inner.gone || {}, sent: file.sent || {}, file };
}

async function saveState(secret, state) {
  const inner = JSON.stringify({ subs: state.subs, gone: state.gone });
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, await storeKey(secret), new TextEncoder().encode(inner));
  const out = {
    v: 1,
    note: "Devices signed up for game reminders. The list is encrypted; see scripts/send-reminders.mjs.",
    devices: `${b64.enc(iv)}.${b64.enc(ct)}`,
    sent: state.sent,
  };
  await mkdir(dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify(out, null, 2) + "\n");
}

// ---------- Mailbox ----------
async function mailboxUrl() {
  const src = await readFile(CLIENT, "utf8");
  const pick = (name) => src.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1];
  return { url: pick("MAILBOX"), vapid: pick("VAPID_KEY") };
}

async function readMailbox(url) {
  let text;
  if (opt("--mailbox-file")) {
    text = await readFile(opt("--mailbox-file"), "utf8");
  } else {
    // ntfy.sh keeps messages for 12 hours; every run reads all of them, and
    // applying them again does nothing new.
    const res = await fetch(`${url}/json?poll=1&since=all`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`mailbox: HTTP ${res.status}`);
    text = await res.text();
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((m) => m?.event === "message" && typeof m.message === "string")
    .sort((a, b) => a.time - b.time);
}

async function open(secret, sealed) {
  const [v, eph, iv, ct] = sealed.trim().split(".");
  if (v !== "v1" || !ct) throw new Error("not a reminder message");
  const priv = await subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", ...secret.mailbox, ext: true },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const pub = await subtle.importKey("raw", b64.dec(eph), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hkdf = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("habs-reminders-v1") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64.dec(iv) }, key, b64.dec(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

function validSub(sub) {
  try {
    const u = new URL(sub.endpoint);
    return (
      u.protocol === "https:" &&
      PUSH_HOSTS.some((re) => re.test(u.hostname)) &&
      sub.endpoint.length < 1024 &&
      /^[A-Za-z0-9_-]{80,100}={0,2}$/.test(sub.keys?.p256dh || "") &&
      /^[A-Za-z0-9_-]{16,32}={0,2}$/.test(sub.keys?.auth || "")
    );
  } catch {
    return false;
  }
}

function apply(state, op, at) {
  if (op?.op === "add" && validSub(op.sub)) {
    const ep = op.sub.endpoint;
    const lang = op.lang === "en" ? "en" : "fr";
    if (state.gone[ep] && state.gone[ep] >= at) return;
    if (op.old && op.old !== ep) delete state.subs[op.old];
    if (!state.subs[ep] && Object.keys(state.subs).length >= MAX_DEVICES) {
      console.warn(`! Already ${MAX_DEVICES} devices; ignoring a new one.`);
      return;
    }
    const keys = { p256dh: op.sub.keys.p256dh, auth: op.sub.keys.auth };
    state.subs[ep] = { keys, lang, since: state.subs[ep]?.since || new Date(at).toISOString() };
  } else if (op?.op === "remove" && typeof op.endpoint === "string") {
    delete state.subs[op.endpoint];
  }
}

// ---------- Sending ----------
async function sendAll(webpush, secret, state, makePayload, ttl, topic) {
  const results = { ok: 0, gone: 0, failed: 0 };
  for (const [endpoint, dev] of Object.entries(state.subs)) {
    const payload = makePayload(dev.lang);
    if (DRY) {
      console.log(`  would send to ${short(endpoint)} (${dev.lang}): ${payload.title} | ${payload.body.replace(/\n/g, " | ")}`);
      results.ok++;
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint, keys: dev.keys }, JSON.stringify(payload), {
        vapidDetails: { subject: SITE, publicKey: secret.vapid.publicKey, privateKey: secret.vapid.privateKey },
        TTL: ttl,
        urgency: "high",
        topic,
        timeout: 20000,
      });
      results.ok++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // The device unsubscribed or the app was removed: forget it.
        console.log(`  ${short(endpoint)} is no longer signed up; removing it.`);
        delete state.subs[endpoint];
        state.gone[endpoint] = NOW;
        results.gone++;
      } else {
        console.warn(`! ${short(endpoint)}: ${err.statusCode || ""} ${err.body || err.message}`.trim());
        results.failed++;
      }
    }
  }
  return results;
}

async function makeKeys() {
  const webpush = (await import("web-push")).default;
  const vapid = webpush.generateVAPIDKeys();
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const jwk = await subtle.exportKey("jwk", kp.privateKey);
  const secret = { vapid, mailbox: { d: jwk.d, x: jwk.x, y: jwk.y }, store: b64.enc(randomBytes(32)) };
  const topic = "habs-rappels-" + randomBytes(10).toString("hex");
  console.log("REMINDERS_SECRET (paste into the repo secret):\n");
  console.log(JSON.stringify(secret));
  console.log("\nIn site/js/reminders.js:");
  console.log(`const VAPID_KEY = "${vapid.publicKey}";`);
  console.log(`const MAILBOX_KEY = "${b64.enc(await subtle.exportKey("raw", kp.publicKey))}";`);
  console.log(`const MAILBOX = "https://ntfy.sh/${topic}";`);
  console.log("\nThen delete reminders/state.json; everyone turns reminders on again once.");
}

async function main() {
  if (args[0] === "keys") return makeKeys();

  const secret = readSecret();
  if (!secret) {
    console.log("::warning::Game reminders are not set up yet: add the REMINDERS_SECRET repository secret.");
    return;
  }
  const client = await mailboxUrl();
  if (client.vapid !== secret.vapid.publicKey) {
    console.log("::warning::VAPID_KEY in site/js/reminders.js doesn't match REMINDERS_SECRET; browsers will refuse the reminders.");
  }

  const state = await loadState(secret);
  const before = JSON.stringify([state.subs, state.gone, state.sent]);

  try {
    const messages = await readMailbox(client.url);
    let readable = 0;
    for (const m of messages) {
      let op;
      try {
        op = await open(secret, m.message);
      } catch {
        continue; // not ours, or junk
      }
      readable++;
      apply(state, op, m.time * 1000);
    }
    console.log(`Mailbox: ${messages.length} messages, ${readable} readable.`);
  } catch (err) {
    // Sign-ups wait for the next run; reminders still go out.
    console.warn(`! Couldn't read the mailbox: ${err.message}`);
  }
  console.log(`${Object.keys(state.subs).length} device(s) signed up.`);

  const webpush = DRY ? null : (await import("web-push")).default;

  if (flag("--test")) {
    const r = await sendAll(webpush, secret, state, (lang) => ({
      title: TEXT[lang].testTitle,
      body: TEXT[lang].testBody,
      tag: "habs-test",
      lang,
      url: "./",
      ts: NOW,
    }), 3600, "test");
    console.log(`Test: ${r.ok} sent, ${r.gone} removed, ${r.failed} failed.`);
  } else {
    const data = JSON.parse(await readFile(DATA, "utf8"));
    const due = (data.games || []).filter((g) => {
      const until = new Date(g.start).getTime() - NOW;
      return g.state === "FUT" && !g.tbd && until > 0 && until <= LEAD_MIN * 60000 && !state.sent[g.id];
    });
    for (const g of due) {
      const ttl = Math.max(60, Math.floor((new Date(g.start).getTime() - NOW) / 1000));
      console.log(`Reminder for game ${g.id} (${g.home ? "vs" : "@"} ${g.opp}, ${g.start}):`);
      const r = await sendAll(webpush, secret, state, (lang) => reminder(g, lang), ttl, `g${g.id}`);
      console.log(`  ${r.ok} sent, ${r.gone} removed, ${r.failed} failed.`);
      // Try again next run only if every device failed for a passing reason.
      if (!(r.failed > 0 && r.ok === 0)) state.sent[g.id] = new Date(NOW).toISOString();
    }
    if (!due.length) console.log("No reminders due right now.");
  }

  // Forget old bookkeeping.
  for (const [id, at] of Object.entries(state.sent)) if (NOW - new Date(at) > 3 * 86400000) delete state.sent[id];
  for (const [ep, at] of Object.entries(state.gone)) if (NOW - at > 2 * 86400000) delete state.gone[ep];

  if (JSON.stringify([state.subs, state.gone, state.sent]) !== before && !DRY) {
    await saveState(secret, state);
    console.log("Saved reminders/state.json.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
