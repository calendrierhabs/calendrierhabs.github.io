// Game-day reminders: a notification on this device 1 hour before each game.
//
// There's no server. When someone turns reminders on, the browser makes a
// push subscription and drops it, encrypted, in a private ntfy.sh mailbox.
// The "Send game reminders" workflow on GitHub picks it up, keeps it
// (encrypted) in the repo and sends the reminders. If a message gets lost, the
// app sends it again the next day it's opened, so nothing needs fixing by hand.

// Public halves of the keys in the REMINDERS_SECRET repo secret.
// `node scripts/send-reminders.mjs keys` makes a new set.
const VAPID_KEY = "BAd4n6KBwwCuB05NBJaIc9SjtxhKmorG9c9xS79odZf4oSy-YUQn4Hd1MnxAUi4t1G8_YtA1aIGYD_0egQ13U5o";
const MAILBOX_KEY = "BDDeiK_vnTSszWAPFN7eyn2jhu42j5HlT0G6-tK8A0h5eP8zXtxDHeXycscFY6HtIUmsOigtAznJb1pOSrL49OQ";
const MAILBOX = "https://ntfy.sh/habs-rappels-30khfcchgj7ml0sh";
const RESYNC_MS = 24 * 3600 * 1000;

const STR = {
  fr: {
    title: "Rappels de match",
    offSub: "Recevez une notification 1 heure avant chaque match, avec la chaîne télé.",
    turnOn: "Me le rappeler",
    busy: "Un instant…",
    onTitle: "Rappels activés",
    onSub: "Une notification arrivera sur cet appareil 1 heure avant chaque match.",
    stop: "Arrêter",
    askStop: "Arrêter les rappels sur cet appareil ?",
    yesStop: "Oui, arrêter",
    noStop: "Non, garder",
    blockedTitle: "Les notifications sont bloquées",
    blockedSub: "Permettez les notifications pour ce site dans les réglages du navigateur, puis touchez Réessayer.",
    errTitle: "Ça n'a pas fonctionné",
    errSub: "Vérifiez la connexion Internet, puis réessayez.",
    retry: "Réessayer",
    doneTitle: "C'est parfait !",
    doneBody: "Vous recevrez une notification comme celle-ci 1 heure avant chaque match des Canadiens.",
  },
  en: {
    title: "Game reminders",
    offSub: "Get a notification 1 hour before every game, with the TV channel.",
    turnOn: "Remind me",
    busy: "One moment…",
    onTitle: "Reminders are on",
    onSub: "A notification will arrive on this device 1 hour before every game.",
    stop: "Turn off",
    askStop: "Turn off reminders on this device?",
    yesStop: "Yes, turn off",
    noStop: "No, keep them",
    blockedTitle: "Notifications are blocked",
    blockedSub: "Allow notifications for this site in the browser settings, then tap Try again.",
    errTitle: "That didn't work",
    errSub: "Check the internet connection, then try again.",
    retry: "Try again",
    doneTitle: "All set!",
    doneBody: "You'll get a notification like this one 1 hour before every Canadiens game.",
  },
};

const BELL = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const RING = BELL + '<path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>';
const svg = (paths) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  },
  del(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};
const ON = "habs.remind";
const SYNC = "habs.remindSync";

const supported =
  window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// off | busy | on | ask | blocked | error
let status = "off";
let getLang = () => "fr";
let onChange = () => {};

function set(next) {
  if (next === status) return;
  status = next;
  onChange();
}

// ---------- Encryption for the mailbox ----------
const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
};

// ECDH with a fresh key + HKDF + AES-GCM. Only the workflow can read it.
export async function seal(obj) {
  const { subtle } = crypto;
  const theirs = await subtle.importKey("raw", b64.dec(MAILBOX_KEY), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const mine = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "ECDH", public: theirs }, mine.privateKey, 256);
  const hkdf = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("habs-reminders-v1") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return ["v1", b64.enc(await subtle.exportKey("raw", mine.publicKey)), b64.enc(iv), b64.enc(ct)].join(".");
}

async function post(obj) {
  const res = await fetch(MAILBOX, { method: "POST", body: await seal(obj) });
  if (!res.ok) throw new Error(`mailbox ${res.status}`);
}

// ---------- Push subscription ----------
const ready = () =>
  Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 15000)),
  ]);

async function subscription(reg) {
  const key = b64.dec(VAPID_KEY);
  let sub = await reg.pushManager.getSubscription();
  const same = (a) => a && a.byteLength === key.length && new Uint8Array(a).every((v, i) => v === key[i]);
  if (sub && !same(sub.options?.applicationServerKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

// Tell the workflow about this device, unless it heard from us recently.
async function sync(sub, force = false) {
  let last = null;
  try { last = JSON.parse(store.get(SYNC)); } catch {}
  const lang = getLang();
  if (!force && last?.endpoint === sub.endpoint && last.lang === lang && Date.now() - last.at < RESYNC_MS) return;
  const msg = { op: "add", sub: sub.toJSON(), lang, at: Date.now() };
  if (last?.endpoint && last.endpoint !== sub.endpoint) msg.old = last.endpoint;
  await post(msg);
  store.set(SYNC, JSON.stringify({ endpoint: sub.endpoint, lang, at: Date.now() }));
}

async function turnOn() {
  set("busy");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return set(perm === "denied" ? "blocked" : "off");
    const reg = await ready();
    const sub = await subscription(reg);
    store.set(ON, "1");
    set("on");
    const s = STR[getLang()];
    reg.showNotification(s.doneTitle, { body: s.doneBody, icon: "icons/icon-192.png", badge: "icons/badge-96.png", tag: "habs-welcome", lang: getLang() });
    await sync(sub, true).catch(() => {}); // retried on the next visit
  } catch {
    set("error");
  }
}

async function turnOff() {
  set("busy");
  try {
    const reg = await ready();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      // The workflow also drops a device on its own once it stops answering.
      post({ op: "remove", endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {}
  store.del(ON);
  store.del(SYNC);
  set("off");
}

// Quietly keep things working on each visit: renew a lost subscription and
// remind the workflow about this device once a day.
async function check() {
  if (!supported || store.get(ON) !== "1" || status === "busy") return;
  if (Notification.permission === "denied") return set("blocked");
  if (Notification.permission !== "granted") {
    store.del(ON);
    return set("off");
  }
  if (status !== "ask") set("on");
  try {
    const reg = await ready();
    await sync(await subscription(reg));
  } catch {}
}

// ---------- What app.js uses ----------
export function start(opts) {
  getLang = opts.lang;
  onChange = opts.onChange;
  if (!supported) return;
  if (store.get(ON) === "1") status = Notification.permission === "denied" ? "blocked" : "on";
  check();
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}

export const languageChanged = () => check();

export function action(name) {
  if (name === "remind") turnOn();
  else if (name === "remind-off") set("ask");
  else if (name === "remind-off-yes") turnOff();
  else if (name === "remind-off-no") set("on");
}

export function card(lang) {
  if (!supported) return "";
  const s = STR[lang] || STR.fr;
  const on = status === "on" || status === "ask";
  const big = (label, act = "remind", disabled = false) =>
    `<button class="remind-btn" data-action="${act}" ${disabled ? "disabled" : ""}>${svg(BELL)}<span>${label}</span></button>`;
  const head = (title, sub) =>
    `<div class="remind-head"><span class="remind-icon${on ? " on" : ""}">${svg(on ? RING : BELL)}</span>
      <div class="row-main"><div class="remind-title">${title}</div><div class="row-sub">${sub}</div></div></div>`;

  let body;
  if (status === "on") {
    body = `<div class="remind-head"><span class="remind-icon on">${svg(RING)}</span>
      <div class="row-main"><div class="remind-title">${s.onTitle}</div><div class="row-sub">${s.onSub}</div></div>
      <button class="remind-stop" data-action="remind-off">${s.stop}</button></div>`;
  } else if (status === "ask") {
    body = `${head(s.onTitle, s.askStop)}
      <div class="remind-choice">
        <button class="remind-btn quiet" data-action="remind-off-no">${s.noStop}</button>
        <button class="remind-btn" data-action="remind-off-yes">${s.yesStop}</button>
      </div>`;
  } else if (status === "blocked") {
    body = head(s.blockedTitle, s.blockedSub) + big(s.retry);
  } else if (status === "error") {
    body = head(s.errTitle, s.errSub) + big(s.retry);
  } else {
    body = head(s.title, s.offSub) + big(status === "busy" ? s.busy : s.turnOn, "remind", status === "busy");
  }
  return `<section class="card card-pad remind" aria-live="polite">${body}</section>`;
}
