# 🏁 Gilberts at the Brickyard — Indy 500 Family Tracker

A phone-friendly app for the whole family to play along with the Indianapolis 500.
Everyone picks their drivers, then watches a live leaderboard, family standings,
position-change sounds, and confetti as the race unfolds.

## Open it

- **Demo (works on any phone now):** https://tgilbert14.github.io/indy-500/
- **Full live version:** runs on a small server so picks sync across everyone's
  phones and the race auto-updates — see `DEPLOY.md`.

> The demo link is "on-device": each phone keeps its own picks and the race is a
> simulation. Once the app is running on the server (Azure), the *same* screens
> show shared picks and the real, live race automatically.

## How to use it

**1. Add the family — "Picks" tab.**
Type each person's name and tap **Add**. Then tap a person and choose their drivers
from the grid (each driver shows their starting spot, car number, team, and ★ for
past Indy 500 wins).

**2. Make picks — the one rule.**
Everyone picks **3 or more** drivers. Two people are allowed to share drivers, but
**no two people can pick the exact same set** — if you try, the app asks you to swap
at least one driver. (Order doesn't matter: {Palou, Dixon, O'Ward} is the same set
in any order.)

**3. Watch the standings — "Family" tab.**
Each person is ranked by the **average running position** of their drivers (lower is
better). The current leader gets a 👑. Before the race, you'll see a live countdown
to the green flag.

**4. Follow the race — "Leaderboard" tab.**
The full 33-car field in running order. Your family's picked drivers are highlighted
in gold and tagged with who picked them. Tap any driver for a detail card (team,
country, Indy 500 wins, who picked them).

**5. Sounds & alerts.**
Drivers gaining or losing spots trigger little sound effects and pop-up alerts, and a
picked driver taking the lead sets off a fanfare + confetti. Tap the 🔊 button to mute.

## Race Control (for the scorekeeper)

Tap the **⚙️ gear** in the top corner and enter the PIN to open **Race Control**.
This is where you choose how the live race updates:

- **Auto** — the server quietly reads IndyCar's public live leaderboard and updates
  everyone automatically. (Full version only.)
- **Manual** — you set the running order yourself from the TV broadcast: tap ▲/▼ to
  move drivers, set the lap and flag, then **Push to everyone**. A reliable backup if
  Auto ever stalls.
- **Sim** — runs a fake race so the family can try everything before Sunday.

*(In the on-device demo, the PIN is `1911` and only Sim and Manual do anything, since
Auto needs the server.)*

## Race-day tip

A few days before, open Race Control → **Sim** so everyone learns the app. On Sunday,
switch to **Auto** about 30 minutes before the green flag and watch the Leaderboard
tab fill with real positions. If it ever shows a ⚠ warning, switch to **Manual** and
keep the top 10–15 roughly accurate — it syncs to all phones instantly.
