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
(pure functions, tested in Node) · `cloud.js` online profiles (Supabase; off when `CLOUD_CONFIG` is empty and on
the claude.ai page; setup in DESIGN.md, schema in `server/supabase.sql`) · `art.js` · `audio.js` · `voice.js` · `bosses.js` · `talents.js` chapter talent effects ·
`game.js` simulation, networking, UI ·
`index.html` loads them in that order with a `?v=N` cache-busting number.

## Build, test, publish

```sh
# PeerJS isn't fetchable from every sandbox; dist/duskbound.html contains a copy, extract it with:
awk '/^<script>$/{f=1;buf="";next} f&&/^<\/script>$/{f=0; if(buf ~ /chunkedMTU/){printf "%s",buf; exit}; next} f{buf=buf $0 "\n"}' dist/duskbound.html > /tmp/peerjs.min.js
sh build.sh /tmp/peerjs.min.js          # writes dist/duskbound.html and dist/artifact.html

node tests/meta.test.js                 # rules (odds, claims, unlocks, profiles)
node tests/talents.test.js             # chapter talents, all 30 effects (Node, tests/sim-harness.js; no browser)
node tests/talents-coop.test.js        # host + guest picking a talent
node tests/talents-soak.test.js        # every hero with all five talents, long run
node tests/e2e/progression.test.js      # Playwright; needs dist/ built
node tests/e2e/voice.test.js
node tests/e2e/peer.test.js
node tests/e2e/mic.test.js
node tests/e2e/fullscreen.test.js
node tests/e2e/heroes.test.js
node tests/e2e/auto.test.js
node tests/e2e/unseal.test.js
node tests/e2e/downed.test.js
node tests/e2e/touchmode.test.js
node tests/e2e/bosses.test.js
node tests/e2e/bosses-coop.test.js
```

When changing any `.js` file: bump `?v=N` on every script tag in `index.html`, rebuild `dist/`, run the tests.
Publish the website by pushing the same commit to `gh-pages` (`git push origin HEAD:gh-pages`); update the claude.ai
page by republishing `dist/artifact.html` to the URL above.

## Rules that were decided (keep them)

- Phones first: landscape layout, safe areas (notch), touch controls, iPhone Safari quirks (audio session switches
  to `play-and-record` only while the mic is on; menus are sticky so a swipe hides Safari's bars).
- Host is authoritative. Chapter reward rolls are OFF (decided 2026-11-23, `CHAPTER_REWARDS.roll = false` in
  `meta.js`): finishing a chapter grants a chapter talent pick instead. With rolls on: one roll per player per chapter
  (green 45 / blue 30 / purple 15 / yellow 7 / red 3 %, no "no reward"). Claims stay keyed `run:chapter:profile` and
  are still recorded (the campaign clear after Chapter 5 rides on them), never rerolled; boss phases and summons never roll.
- Difficulty: Normal → Nightmare → Hell → Inferno; a five-chapter clear unlocks only the next; a party may only
  play a difficulty every member has unlocked.
- Profiles use a random installation id (no device id exists on the web); rejoin needs the host's per-session
  secret plus the same profile; no host migration.
- Chapter bosses (`bosses.js`, balance in `BOSSES`): Elderoot (original tree guardian, not Marvel's Groot), Poseidon,
  Gorath, Raivolt, Nezha, getting harder in that order. Telegraph every damaging attack (>= 0.4 s), keep safe gaps,
  apply difficulty and party scaling once and no chapter multiplier, keep every boss beatable solo with the starting
  heroes. Host runs the boss; guests apply pull/cage/slow locally. See DESIGN.md "Chapter bosses".
- Chapters 4–5 biomes are placeholders (palettes only).
- Six heroes: Bramble, Wick, Vesper (everyone has them) and the unlockable Rowan (Green), Mira (Blue), Vespera
  (Purple). They are character rewards inside the one chapter roll (`c:<id>` in `REWARD_POOLS`), winnable from
  Chapter 1 / 2 / 3; there is no separate character roll. Unlocks live in the profile (`PROFILE.characters`); the
  host only lets a guest play a hero their profile owns. Rowan and Vespera cast a second skill from the dash slot.
- The boss is unsealed early by standing in the altar ring for `UNSEAL_TIME` (5 s, `data.js`), not by pressing F;
  any living player counts, the host keeps the time, progress drains when the ring is empty.
- Network messages changed: `PEER_PREFIX` is `duskbound-v8-`. Bump it whenever messages change.
- Work happens on a branch, then a pull request into `main`. Pull before starting, so PC and phone sessions don't
  drift apart again.
- Online profiles merge, never overwrite (`mergeProfiles`); sign-in is email + password with no email
  confirmation (works in the Home Screen app; reset by emailed link); the profile id never changes mid-run; only the
  publishable key may appear in the game. Supabase project `ojsjccqugdnuhhmewtqy` (free plan, pauses after a week idle).
- Chapter talents: five per hero (`HERO_TALENTS`), kept for the run only (like boons). Decided 2026-11-23: after
  every chapter except the last, each player picks one of 3 random cards from their hero's talents not yet picked
  (`CHAPTER_TALENT = { policy: 'every', cards: 3 }`). See DESIGN.md.
- While rolls are off, Rowan, Mira and Vespera cannot be won (their only source is the chapter roll); heroes already
  unlocked stay unlocked.
- Every user-facing string needs a Traditional Chinese version.
