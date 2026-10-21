// Every NHL team: French and English names, plus badge colours (shown when
// the team's logo can't load).
// The data feed also carries names, so a team missing here still displays.
export const TEAMS = {
  ANA: { city: ["Anaheim", "Anaheim"], name: ["Ducks", "Ducks"], bg: "#F47A38", fg: "#111111" },
  BOS: { city: ["Boston", "Boston"], name: ["Bruins", "Bruins"], bg: "#111111", fg: "#FFB81C" },
  BUF: { city: ["Buffalo", "Buffalo"], name: ["Sabres", "Sabres"], bg: "#003087", fg: "#FFB81C" },
  CGY: { city: ["Calgary", "Calgary"], name: ["Flames", "Flames"], bg: "#C8102E", fg: "#FFFFFF" },
  CAR: { city: ["Caroline", "Carolina"], name: ["Hurricanes", "Hurricanes"], bg: "#CE1126", fg: "#FFFFFF" },
  CHI: { city: ["Chicago", "Chicago"], name: ["Blackhawks", "Blackhawks"], bg: "#CF0A2C", fg: "#FFFFFF" },
  COL: { city: ["Colorado", "Colorado"], name: ["Avalanche", "Avalanche"], bg: "#6F263D", fg: "#FFFFFF" },
  CBJ: { city: ["Columbus", "Columbus"], name: ["Blue Jackets", "Blue Jackets"], bg: "#002654", fg: "#FFFFFF" },
  DAL: { city: ["Dallas", "Dallas"], name: ["Stars", "Stars"], bg: "#006847", fg: "#FFFFFF" },
  DET: { city: ["Détroit", "Detroit"], name: ["Red Wings", "Red Wings"], bg: "#CE1126", fg: "#FFFFFF" },
  EDM: { city: ["Edmonton", "Edmonton"], name: ["Oilers", "Oilers"], bg: "#041E42", fg: "#FF4C00" },
  FLA: { city: ["Floride", "Florida"], name: ["Panthers", "Panthers"], bg: "#041E42", fg: "#FFFFFF" },
  LAK: { city: ["Los Angeles", "Los Angeles"], name: ["Kings", "Kings"], bg: "#111111", fg: "#FFFFFF" },
  MIN: { city: ["Minnesota", "Minnesota"], name: ["Wild", "Wild"], bg: "#154734", fg: "#FFFFFF" },
  MTL: { city: ["Montréal", "Montréal"], name: ["Canadiens", "Canadiens"], bg: "#AF1E2D", fg: "#FFFFFF" },
  NSH: { city: ["Nashville", "Nashville"], name: ["Predators", "Predators"], bg: "#FFB81C", fg: "#041E42" },
  NJD: { city: ["New Jersey", "New Jersey"], name: ["Devils", "Devils"], bg: "#CE1126", fg: "#FFFFFF" },
  NYI: { city: ["New York", "New York"], name: ["Islanders", "Islanders"], bg: "#00539B", fg: "#FFFFFF" },
  NYR: { city: ["New York", "New York"], name: ["Rangers", "Rangers"], bg: "#0038A8", fg: "#FFFFFF" },
  OTT: { city: ["Ottawa", "Ottawa"], name: ["Sénateurs", "Senators"], bg: "#C52032", fg: "#FFFFFF" },
  PHI: { city: ["Philadelphie", "Philadelphia"], name: ["Flyers", "Flyers"], bg: "#F74902", fg: "#111111" },
  PIT: { city: ["Pittsburgh", "Pittsburgh"], name: ["Penguins", "Penguins"], bg: "#111111", fg: "#FCB514" },
  SJS: { city: ["San Jose", "San Jose"], name: ["Sharks", "Sharks"], bg: "#006D75", fg: "#FFFFFF" },
  SEA: { city: ["Seattle", "Seattle"], name: ["Kraken", "Kraken"], bg: "#001628", fg: "#99D9D9" },
  STL: { city: ["St. Louis", "St. Louis"], name: ["Blues", "Blues"], bg: "#002F87", fg: "#FCB514" },
  TBL: { city: ["Tampa Bay", "Tampa Bay"], name: ["Lightning", "Lightning"], bg: "#002868", fg: "#FFFFFF" },
  TOR: { city: ["Toronto", "Toronto"], name: ["Maple Leafs", "Maple Leafs"], bg: "#00205B", fg: "#FFFFFF" },
  UTA: { city: ["Utah", "Utah"], name: ["Mammoth", "Mammoth"], bg: "#010101", fg: "#6CACE4" },
  VAN: { city: ["Vancouver", "Vancouver"], name: ["Canucks", "Canucks"], bg: "#00205B", fg: "#FFFFFF" },
  VGK: { city: ["Vegas", "Vegas"], name: ["Golden Knights", "Golden Knights"], bg: "#333F42", fg: "#B4975A" },
  WSH: { city: ["Washington", "Washington"], name: ["Capitals", "Capitals"], bg: "#C8102E", fg: "#FFFFFF" },
  WPG: { city: ["Winnipeg", "Winnipeg"], name: ["Jets", "Jets"], bg: "#041E42", fg: "#FFFFFF" },
};

export function team(abbrev, lang, fallback = {}) {
  const t = TEAMS[abbrev];
  const i = lang === "fr" ? 0 : 1;
  return {
    abbrev,
    city: t ? t.city[i] : fallback.place?.[lang] || fallback.place?.en || abbrev,
    name: t ? t.name[i] : fallback.name?.[lang] || fallback.name?.en || abbrev,
    bg: t ? t.bg : "#5A6178",
    fg: t ? t.fg : "#FFFFFF",
  };
}
