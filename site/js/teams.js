// Every NHL team: French and English names, badge colours (shown when the
// team's logo can't load), and z: how much to enlarge the NHL's logo file so
// the logo itself fills its square (the files have wide empty margins).
// The data feed also carries names, so a team missing here still displays.
export const TEAMS = {
  ANA: { city: ["Anaheim", "Anaheim"], name: ["Ducks", "Ducks"], bg: "#F47A38", fg: "#111111", z: 1.70 },
  BOS: { city: ["Boston", "Boston"], name: ["Bruins", "Bruins"], bg: "#111111", fg: "#FFB81C", z: 1.73 },
  BUF: { city: ["Buffalo", "Buffalo"], name: ["Sabres", "Sabres"], bg: "#003087", fg: "#FFB81C", z: 1.72 },
  CGY: { city: ["Calgary", "Calgary"], name: ["Flames", "Flames"], bg: "#C8102E", fg: "#FFFFFF", z: 1.76 },
  CAR: { city: ["Caroline", "Carolina"], name: ["Hurricanes", "Hurricanes"], bg: "#CE1126", fg: "#FFFFFF", z: 1.44 },
  CHI: { city: ["Chicago", "Chicago"], name: ["Blackhawks", "Blackhawks"], bg: "#CF0A2C", fg: "#FFFFFF", z: 1.70 },
  COL: { city: ["Colorado", "Colorado"], name: ["Avalanche", "Avalanche"], bg: "#6F263D", fg: "#FFFFFF", z: 1.69 },
  CBJ: { city: ["Columbus", "Columbus"], name: ["Blue Jackets", "Blue Jackets"], bg: "#002654", fg: "#FFFFFF", z: 1.61 },
  DAL: { city: ["Dallas", "Dallas"], name: ["Stars", "Stars"], bg: "#006847", fg: "#FFFFFF", z: 1.44 },
  DET: { city: ["Détroit", "Detroit"], name: ["Red Wings", "Red Wings"], bg: "#CE1126", fg: "#FFFFFF", z: 1.42 },
  EDM: { city: ["Edmonton", "Edmonton"], name: ["Oilers", "Oilers"], bg: "#041E42", fg: "#FF4C00", z: 1.71 },
  FLA: { city: ["Floride", "Florida"], name: ["Panthers", "Panthers"], bg: "#041E42", fg: "#FFFFFF", z: 1.79 },
  LAK: { city: ["Los Angeles", "Los Angeles"], name: ["Kings", "Kings"], bg: "#111111", fg: "#FFFFFF", z: 1.33 },
  MIN: { city: ["Minnesota", "Minnesota"], name: ["Wild", "Wild"], bg: "#154734", fg: "#FFFFFF", z: 1.44 },
  MTL: { city: ["Montréal", "Montréal"], name: ["Canadiens", "Canadiens"], bg: "#AF1E2D", fg: "#FFFFFF", z: 1.46 },
  NSH: { city: ["Nashville", "Nashville"], name: ["Predators", "Predators"], bg: "#FFB81C", fg: "#041E42", z: 1.55 },
  NJD: { city: ["New Jersey", "New Jersey"], name: ["Devils", "Devils"], bg: "#CE1126", fg: "#FFFFFF", z: 1.81 },
  NYI: { city: ["New York", "New York"], name: ["Islanders", "Islanders"], bg: "#00539B", fg: "#FFFFFF", z: 1.82 },
  NYR: { city: ["New York", "New York"], name: ["Rangers", "Rangers"], bg: "#0038A8", fg: "#FFFFFF", z: 1.93 },
  OTT: { city: ["Ottawa", "Ottawa"], name: ["Sénateurs", "Senators"], bg: "#C52032", fg: "#FFFFFF", z: 1.46 },
  PHI: { city: ["Philadelphie", "Philadelphia"], name: ["Flyers", "Flyers"], bg: "#F74902", fg: "#111111", z: 1.70 },
  PIT: { city: ["Pittsburgh", "Pittsburgh"], name: ["Penguins", "Penguins"], bg: "#111111", fg: "#FCB514", z: 1.72 },
  SJS: { city: ["San Jose", "San Jose"], name: ["Sharks", "Sharks"], bg: "#006D75", fg: "#FFFFFF", z: 1.51 },
  SEA: { city: ["Seattle", "Seattle"], name: ["Kraken", "Kraken"], bg: "#001628", fg: "#99D9D9", z: 1.81 },
  STL: { city: ["St. Louis", "St. Louis"], name: ["Blues", "Blues"], bg: "#002F87", fg: "#FCB514", z: 1.74 },
  TBL: { city: ["Tampa Bay", "Tampa Bay"], name: ["Lightning", "Lightning"], bg: "#002868", fg: "#FFFFFF", z: 1.69 },
  TOR: { city: ["Toronto", "Toronto"], name: ["Maple Leafs", "Maple Leafs"], bg: "#00205B", fg: "#FFFFFF", z: 1.68 },
  UTA: { city: ["Utah", "Utah"], name: ["Mammoth", "Mammoth"], bg: "#010101", fg: "#6CACE4", z: 1.39 },
  VAN: { city: ["Vancouver", "Vancouver"], name: ["Canucks", "Canucks"], bg: "#00205B", fg: "#FFFFFF", z: 1.68 },
  VGK: { city: ["Vegas", "Vegas"], name: ["Golden Knights", "Golden Knights"], bg: "#333F42", fg: "#B4975A", z: 1.74 },
  WSH: { city: ["Washington", "Washington"], name: ["Capitals", "Capitals"], bg: "#C8102E", fg: "#FFFFFF", z: 1.35 },
  WPG: { city: ["Winnipeg", "Winnipeg"], name: ["Jets", "Jets"], bg: "#041E42", fg: "#FFFFFF", z: 1.68 },
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
    z: t ? t.z : 1.6,
  };
}
