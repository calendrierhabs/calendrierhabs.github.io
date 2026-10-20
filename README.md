# Habs · Calendrier des Canadiens

A bilingual (French/English) Montréal Canadiens calendar that updates itself.
It's a web app you install on a phone or laptop like a regular app.

- **Accueil / Home:** the next game (or the live score), where to watch it, the record, recent results.
- **Calendrier / Calendar:** month view; upcoming games in blue, past games with results.
- **Classement / Standings:** division, conference and league.
- **Équipe / Team:** team leaders and the roster with stats.

Each device remembers its own language and theme (light or red).

## How it stays up to date

`.github/workflows/update.yml` runs every 10 minutes on GitHub. It calls
`scripts/update-data.mjs`, which pulls the schedule, scores, Canadian TV
channels, standings, roster and stats from the NHL's public API
(`api-web.nhle.com`), writes `site/data/habs.json`, and republishes the site on
GitHub Pages. If the NHL feed fails, the last good data is kept.

## Working on it

```sh
node scripts/update-data.mjs --fixtures test/fixtures   # build data from sample files
npx http-server site                                     # open http://localhost:8080
```

No build step and no dependencies: plain HTML, CSS and JavaScript in `site/`.
