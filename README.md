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

GitHub runs those 10-minute schedules much less often than asked, so on game
days `.github/workflows/gameday.yml` (checked twice an hour) picks up the game
up to 12 hours ahead, stays awake from about 75 minutes before puck drop until
the game is final, and starts the update and reminder workflows itself every 5
minutes. Runs are capped near 6 hours, so a run that is about to stop starts
the next one itself.

While a game is on, the app itself also reads the score from ESPN's public
scoreboard every 20 seconds (`site/js/live.js`), since the NHL feed can't be
read from a web page. The data file takes over again once it has the final.

## Working on it

```sh
node scripts/update-data.mjs --fixtures test/fixtures   # build data from sample files
npx http-server site                                     # open http://localhost:8080
```

No build step and no dependencies: plain HTML, CSS and JavaScript in `site/`.

## Game-day reminders

On the home screen, **Me le rappeler / Remind me** turns on a notification
about 1 hour before each game, with the TV channels, in the language the
device uses. It works on Android (Chrome) and on laptops (Chrome, Edge,
Firefox). Each device turns it on once.

There's no server. The app drops the device's push subscription, encrypted,
in a private ntfy.sh mailbox. `.github/workflows/reminders.yml` runs every
10 minutes: `scripts/send-reminders.mjs` reads the mailbox, keeps the device
list encrypted in `reminders/state.json` and sends what's due. Devices that
stop answering are dropped on their own, and the app re-sends its
subscription once a day when opened, so nothing needs looking after.

It needs one repository secret, `REMINDERS_SECRET`. To make a new one (this
signs everyone out of reminders), run `node scripts/send-reminders.mjs keys`
after `npm install --no-save web-push@3.6.7` and follow what it prints.
To check that it works, run the "Send game reminders" workflow by hand with
"Send a test notification" ticked.
