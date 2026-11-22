# Duskbound — notes for Claude

An original top-down action roguelike (canvas, plain JavaScript, no engine, no server) for phones and desktop,
solo or co-op for up to 4 players. English and Traditional Chinese. Full design notes: `DESIGN.md`.

## Where it runs

- **Main version:** GitHub Pages, https://tcf9796-svg.github.io/duskbound/ (served from the `gh-pages` branch).
  Co-op over PeerJS (WebRTC), voice chat, installable as a Home Screen app (`manifest.webmanifest`, `icons/`).
  `?a` opens the "Install app" screen (used by `duskbound-app-qr-card.png`).
- **claude.ai page:** https://claude.ai/artifact/Kyf6zZAZfJ5Ria7tmwfTUc, published from `dist/artifact.html`.
  Co-op over claude.ai's live `room` capability (WebRTC is blocked there), so no voice chat. Players on the
  two versions cannot play together.

## Files

`data.js` content · `i18n.js` translations (`T()` translates English strings at draw time, `L(en, zh)` for whole
sentences; game logic and network messages stay English) · `meta.js` tunables + profiles, rewards, difficulties
(pure functions, tested in Node) · `art.js` · `audio.js` · `voice.js` · `game.js` simulation, networking, UI ·
`index.html` loads them in that order with a `?v=N` cache-busting number.

## Build, test, publish

```sh
# PeerJS isn't fetchable from every sandbox; dist/duskbound.html contains a copy, extract it with:
awk '/^<script>$/{f=1;buf="";next} f&&/^<\/script>$/{f=0; if(buf ~ /chunkedMTU/){printf "%s",buf; exit}; next} f{buf=buf $0 "\n"}' dist/duskbound.html > /tmp/peerjs.min.js
sh build.sh /tmp/peerjs.min.js          # writes dist/duskbound.html and dist/artifact.html

node tests/meta.test.js                 # rules (odds, claims, unlocks, profiles)
node tests/e2e/progression.test.js      # Playwright; needs dist/ built
node tests/e2e/voice.test.js
node tests/e2e/peer.test.js
node tests/e2e/mic.test.js
node tests/e2e/fullscreen.test.js
```

When changing any `.js` file: bump `?v=N` on every script tag in `index.html`, rebuild `dist/`, run the tests.
Publish the website by pushing the same commit to `gh-pages` (`git push origin HEAD:gh-pages`); update the claude.ai
page by republishing `dist/artifact.html` to the URL above.

## Rules that were decided (keep them)

- Phones first: landscape layout, safe areas (notch), touch controls, iPhone Safari quirks (audio session switches
  to `play-and-record` only while the mic is on; menus are sticky so a swipe hides Safari's bars).
- Host is authoritative. Rewards: one roll per player per chapter (green 30 / blue 10 / purple 5 / yellow 2.5 /
  red 1 / none 51.5 %), claims keyed `run:chapter:profile`, never rerolled.
- Difficulty: Normal → Nightmare → Hell → Inferno; a five-chapter clear unlocks only the next; a party may only
  play a difficulty every member has unlocked.
- Profiles use a random installation id (no device id exists on the web); rejoin needs the host's per-session
  secret plus the same profile; no host migration.
- Chapters 4–5 are placeholders (new palettes, existing enemies/boss).
- Six heroes: Bramble, Wick, Vesper (everyone has them) and the unlockable Rowan (Green), Mira (Blue), Vespera
  (Purple). They are character rewards inside the one chapter roll (`c:<id>` in `REWARD_POOLS`), winnable from
  Chapter 1 / 2 / 3; there is no separate character roll. Unlocks live in the profile (`PROFILE.characters`); the
  host only lets a guest play a hero their profile owns. Rowan and Vespera cast a second skill from the dash slot.
- Network messages changed: `PEER_PREFIX` is `duskbound-v3-`. Bump it whenever messages change.
- Work happens on a branch, then a pull request into `main`. Pull before starting, so PC and phone sessions don't
  drift apart again.
- Every user-facing string needs a Traditional Chinese version.
