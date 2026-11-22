# Duskbound — design notes

Plain JavaScript + HTML canvas, no engine and no server. Files load in this order:
`data.js` (content) → `i18n.js` (English / Traditional Chinese) → `meta.js` (progression rules and tunables) →
`art.js` → `audio.js` → `voice.js` → `game.js` (simulation, networking, UI). `build.sh` inlines them into
`dist/duskbound.html` (GitHub Pages / any host, co-op over PeerJS) and `dist/artifact.html` (claude.ai, co-op over
claude.ai's live room). All tunables are at the top of `meta.js`.

## Networking and authority

The host simulates everything; guests send input and render snapshots. Two transports share one interface (`NetT`):
PeerJS/WebRTC (GitHub Pages build) and claude.ai's `room` capability (claude.ai build). Rewards, unlocks and
reconnection are decided by the host.

**Trust limit:** there is no server. Each player's profile lives on their own device and they report their unlocks
and items to the host when joining. The host validates ids and caps every value, but someone who edits their own
browser storage can still give themselves items. Making this tamper-proof needs a server holding profiles.

## Player profiles and identity

- Web pages cannot read a phone/hardware id (browsers deliberately don't expose one). Each install gets a
  **random installation id** (`p_` + 20 characters, `crypto.getRandomValues`) stored in `localStorage` under
  `duskbound-profile`. It is never sent to other players except the host, and it is separate from connection ids.
- Saved: unlocked difficulties, campaign clears, weapons (+ which one each hero has equipped), permanent upgrades,
  starting talents, characters, the last 60 reward results, and claim ids (so nothing is granted twice).
- **Limitations:** a new profile starts when the player clears the site's data, uses private browsing, a different
  browser or device, or the iPhone Home Screen app (it has separate storage from Safari). Reinstalling the Home
  Screen app also starts fresh. Sign in under **Profile → Online profile** (see "Online profiles"), or use **Profile → Backup code** to copy a profile and **Restore** to load it
  elsewhere. Saves are repaired on load (`sanitizeProfile`), so a damaged or edited save can't break the game.
- Three ids, three jobs: **profile id** (who you are, persistent), **rejoin secret** (per session, issued privately by
  the host, proves you may reclaim your slot), **PeerJS/room peer id** (this connection only).

## Online profiles (optional)

`cloud.js` keeps a signed-in player's profile in Supabase, so the same profile works in every browser, on every
device and in the iPhone Home Screen app (which has storage separate from Safari). It is **off until configured**:
with `CLOUD_CONFIG` empty the game behaves exactly as before. It is always off on the claude.ai page (it cannot
reach other servers). No library: plain `fetch` against Supabase's Auth and REST APIs.

- **Sign-in:** Profile → Online profile → email + password → **Sign in** or **Create account** (signed in at once:
  the project skips email confirmation, so no email is needed and it works inside the Home Screen app). **Forgot
  password** emails a reset link that brings the player back to the game to choose a new password; open it on the
  same device. (Supabase's free email sender allows only a few emails per hour and its text can't be changed without
  custom SMTP, which is why sign-in doesn't use emailed codes.) Email addresses are not verified.
- **Sync:** at start-up, after every saved change (1.5 s later), on "Sync now" and right after signing in. Each sync
  pulls the online copy, merges it with this device's profile (`mergeProfiles` in `meta.js`) and uploads the result.
  The merge never loses progress: the online copy's id is kept; rewards it hasn't seen are replayed by claim id (so
  upgrades earned on two devices both count and nothing counts twice); difficulties, characters and weapons are
  combined; clears and talents take the higher value. The id only switches on the title/profile screens, never
  mid-run. Offline, progress stays on the device and goes up at the next successful sync.
- **Sign out** forgets the session; the device keeps its copy of the profile.
- **Not tamper-proof yet:** players write their own row (row-level security limits them to it). Phase 2 would move
  reward rolls into a server function and remove the client write policies.

**Setup (done for project `ojsjccqugdnuhhmewtqy`, Singapore, free plan):**
1. Create a project at supabase.com.
2. SQL Editor → run `server/supabase.sql` (profiles table, grants, row-level security).
3. Authentication → Sign In / Providers → Email: turn off "Confirm email" (Management API: `mailer_autoconfirm: true`);
   minimum password length 6. URL Configuration → Site URL `https://tcf9796-svg.github.io/duskbound/` and the same
   address with `**` in Redirect URLs (for password-reset links).
4. Project Settings → API Keys: put the Project URL and the **publishable** key into `CLOUD_CONFIG` in `cloud.js`
   (it is meant to be public; never put a secret or service_role key in the game).
5. Bump `?v=N`, rebuild `dist/`, publish.

## Difficulty

Normal → Nightmare → Hell → Inferno (`DIFFICULTIES`: health, damage and ambush-rate multipliers). New profiles have
Normal. Clearing all five chapters of a run on a difficulty unlocks only the next one (`recordCampaignClear`,
idempotent per run). Solo play is validated against the player's own unlocks.

**Mixed unlocks in a party:** the host may only pick a difficulty **every player in the lobby has unlocked**. If a
player without it joins, the party drops to the highest difficulty everyone shares. Clear credit goes to every
player in the party when chapter 5 ends (all of them had that difficulty unlocked, so unlock chains stay in order).

## Player-count scaling

`n` = players in the session **including disconnected players whose slot is still held** (grace period).
Applied once, when an enemy spawns; existing enemies are never re-scaled, so nothing's health is ever reset.

```
enemy health = base x day x chapter x difficulty.hp  x (1 + hpPerExtra     x (n - 1))   // hpPerExtra 0.6
enemy damage = base x difficulty.dmg                 x (1 + dmgPerExtra    x (n - 1))   // dmgPerExtra 0
ambush rate  = base x difficulty.ambush              x (1 + ambushPerExtra x (n - 1))   // ambushPerExtra 0.35
```

Defaults match the game's original balance. Counting held slots means disconnecting never makes spawns weaker and
reconnecting never doubles anything; after the grace period (`graceSeconds`, default 120) the slot is released and
`n` drops.

## Chapter rewards

One roll per eligible player per completed chapter, decided by the host:
a single integer draw 0..9999 against `REWARD_ODDS` (basis points, mutually exclusive):

| Rarity | Odds | Draws |
|---|---|---|
| Green | 45% | 0–4499 |
| Blue | 30% | 4500–7499 |
| Purple | 15% | 7500–8999 |
| Yellow | 7% | 9000–9699 |
| Red | 3% | 9700–9999 |
| No reward | 0% | — |

(Changed from 30/10/5/2.5/1 with 51.5% no reward; the requested 50/30/15/7/3 totalled 105%, so Green was set to
45% to make exactly 100% — every completion gives one reward. "No reward" stays supported in code at 0%.)

Then one item is picked from that rarity's pool (`REWARD_POOLS`), skipping items the player already owns or has
capped; if nothing is left, a same-rarity upgrade from `REWARD_FALLBACK` is given instead. Boss difficulty never
changes these odds, and boss phases, summons and other kills never trigger a roll — only completing the chapter.

- **Per-player rolls:** the existing design had no chapter or party rewards (only in-run boons), so each player
  rolls separately.
- **Eligible:** everyone in the session when the chapter ends, including players inside their grace period (their
  result is delivered when they rejoin).
- **Claims:** keyed `runId:chapter:profileId`. The host keeps them for the session, and each device also records
  the claim ids it has applied. So duplicate completion events, reconnects and resends never roll or grant twice.
- **Categories:** upgrades (stackable stats, capped), starting talents (begin each run with one rank of a boon),
  weapons (one per hero, equipped in Profile) and characters.
- **Characters:** the unlockable heroes Rowan (Green), Mira (Blue) and Vespera (Purple) are `c:<id>` items in their
  tier's pool, winnable from Chapter 1, 2 and 3 respectively (`RARITY[...].chapter` in `data.js`). They are part of
  the single roll above, not a separate one. Unlocks are saved in the profile; an older per-device unlock save
  (`duskbound-unlocks`) is imported once. The host only lets a guest play a hero their profile owns.

## Reconnection

A guest who drops keeps their slot for `PARTY_SCALE.graceSeconds`. Rejoining needs **both** the private rejoin
secret the host gave that device and the same profile id. The host restores the same player object (health,
level, gold, boons, weapon, position next to a teammate), re-sends missed reward results, and never creates a
second copy. A failed takeover attempt is refused without disconnecting anyone. A second window from the same
device takes over its own slot; the old window is told why.

**Host migration is not supported.** If the host leaves or crashes, the run ends for everyone; guests can only
reconnect to a host that is still running.

## Campaign: five chapters

Chapters 1–3 are the original biomes. **Chapters 4–5 biomes are placeholders:** new colour palettes ("The Storm
Heights", "The Ember Court", marked `placeholder: true` in `data.js`, shown as "Chapter N (preview)") with the existing
roaming enemies. Each chapter now has its own boss (see "Chapter bosses"). Still missing for chapters 4–5: unique
roaming enemy types, map features, music and art.

## Chapter bosses

`bosses.js`. One boss per chapter, run by the host (AI, damage, phases, victory); guests get the boss's phase,
armour and visibility plus every nearby hazard in each snapshot (`X`), and apply pull / cage / slow effects to their
own hero locally. Everything tunable is in `BOSSES` at the top of `bosses.js`.

**Shared rules.** Every damaging attack is telegraphed first (dashed outline and a growing fill; it turns solid
with a white edge when it deals damage) for at least 0.4 s; ring and wall attacks keep visible safe gaps; arena
warnings (the tsunami) also show on screen under the health bar; touch buttons fade while a warning is up so it
stays visible. After each attack the boss recovers (gold ring, "VULNERABLE", +25% damage taken). Phase 2 starts
once, at 50% health, with a 1.6 s invulnerable transition. Summons and arena objects never drop loot or end the
chapter; cages, bindings and whirlpool cores always expire. Hazards are capped at 60. On defeat (or restart /
next chapter) all hazards, summons and projectiles are removed. No mechanic needs an unlockable hero or an
element: cages break to any attack (including the trapped player's own), and the rest is positioning.

**Scaling, applied once each.** Boss health = `hp` x difficulty `hp` x party scaling; damage = `dmg` x difficulty
`dmg` x party scaling. The general chapter and time-of-day enemy multipliers are not applied to bosses — the boss
table *is* the chapter tuning. Party size is fixed when the boss appears, so disconnects/rejoins never change or
reset its health, and a rejoining player is sent the fight in progress (same boss, same health, no duplicate).

**Balance (Normal, solo).** Sized against the heroes: 95–170 HP, roughly 30–40 damage per second at level 1,
about 2–4x that by Chapters 1–5 from levels and boons. Targets: about 45–90 s fights for a solo player who dodges;
big hits about a fifth of a hero's health.

| Ch | Boss | HP | Base hit | Speed | Pause between attacks | Recovery |
|---|---|---|---|---|---|---|
| 1 | Elderoot, Guardian of the Forest (original design) | 2200 | 22 | 90 | 1.8–2.6 s | 1.8 s |
| 2 | Poseidon, Sovereign of the Tides | 3400 | 26 | 105 | 1.6–2.3 s | 1.5 s |
| 3 | Gorath, the Shifting Colossus | 4600 | 31 | 95 | 1.4–2.1 s | 1.4 s |
| 4 | Raivolt, the Storm Sovereign | 6000 | 35 | 120 | 1.2–1.8 s | 1.1 s |
| 5 | Nezha, the Blazing Lotus Prince | 8000 | 40 | 150 | 1.0–1.5 s | 1.3 s |

Phase 2 shortens pauses to 75% and recoveries to 85%.

1. **Elderoot** (the requested "Groot" is a Marvel character, so this is an original living-tree guardian with the
   same design brief): Branch Hammer (slam, then expanding shockwaves with three gaps), Root Pursuit (roots run along
   marked paths), Vine Prison (a breakable cage), Thorn Volley (marked fan of spikes). Phase 2 *Ancient Growth*:
   bigger, bark armour 15% + 10% per sapling (max 50%); up to 4 saplings heal 1.2%/s each, capped at 20% of his
   health per fight and 4 waves. Destroy saplings to stop the healing and strip the armour.
2. **Poseidon**: Trident Breaker (three marked thrusts, then a widening wave), Tidal Crossing (walls of water from
   alternating sides, each with a safe gap), Whirlpool Prison (pulls you in; destroy its core to end it), Ocean's
   Judgment (raised platforms appear near every player 3.6 s before the tsunami; his armour collapses for 5 s after).
   Water armour = 15% per tide orb (3 orbs, back every 28 s). Phase 2 *Avatar of the Deep* adds marked sea-horse charges.
3. **Gorath**: Boulder Throw (marked landing spots), Seismic Slam (two sets of fissure lines), Colossus Charge
   (marked line). 45% stone armour; bait a charge into a pillar to stun him and break the armour for 7 s (pillars come
   back when fewer than 2 remain). Phase 2 *The Colossus Splits*: every 30 s he splits into three bodies; only the
   one leaving a crystal trail is real, and hits on it land on Gorath; he re-forms after taking 15% damage or 18 s.
4. **Raivolt**: Storm Sweep (three rotating beams, rotation shown by arrows), Lightning Mark (marked strikes;
   standing next to a grounding rod protects you), Chain Lightning (jumps to anyone within 230 of the struck player —
   spread out; solo it's a single dodgeable strike). Phase 2 *The Masks Take Flight*: three masks circle him and fire
   marked beams (at most two at once); each mask adds 20% armour, and destroying one interrupts him.
5. **Nezha**: Fire-Tipped Spear 火尖槍 (marked thrusts ending in a slam), Wind-Fire Wheels 風火輪 (a marked dash that
   leaves burning trails — bait it into a lit stone brazier to stagger him; braziers relight after 15 s), Universe Ring
   乾坤圈 (thrown out and back; both passes hit), Red Sash 混天綾 (a sweep that binds — break the binding), Blazing Lotus
   (petals ignite in waves, one safe petal that moves each wave). Phase 2 *Lotus Ascension*: six spectral arms, longer
   combos, spear finishers throw the ring too.

**Placeholders.** Boss and arena-object art is simple original shapes drawn in code; no sprite art, animation sets or
boss-specific music/sounds yet (they reuse the game's synthesized effects). Chapters 4–5 still use placeholder
biomes (new palettes "The Storm Heights" and "The Ember Court", existing roaming enemies).

## Full screen

A **⛶ Full screen** button is on the title screen, lobby, pause menu and voice panel, plus a small ⛶ in play
(under the pause/voice button) while the game isn't full screen. Turning it on is remembered (`duskbound-fs`): any
later tap goes back into full screen after a notification, rotation or app switch knocked it out, and Android also
locks landscape. "Exit full screen" turns that off. iPhone Safari can't put a web page in full screen (only video),
so there the button explains the two options: swipe up on the title screen (Safari hides its bars) or Add to Home
Screen (the installed app always runs full screen). Not shown on the claude.ai page or inside the installed app.

## Voice chat

`voice.js`, over PeerJS media calls (WebRTC), so it works in the GitHub Pages build with no extra service or
credentials. One call per pair of players (the lower id calls). Everyone can listen without a microphone; turning
the mic on asks for browser permission. Controls (lobby **Voice** button; in co-op play the top-right 🎙 button or
P/Esc opens the panel without pausing): microphone on/off, push-to-talk or open mic, microphone choice,
per-player mute and volume (0–200%, remembered), game sound on/off. Push-to-talk: hold **V**, or the **TALK**
button on touch screens. A 🔊 next to a teammate's name shows who is speaking.

**Not available on claude.ai** (WebRTC is blocked there); the panel says so.

**Setup / limits:** uses the public PeerJS signalling server (`0.peerjs.com`) and Google's public STUN server
(PeerJS defaults). Players behind strict NATs or firewalls may connect for game data but fail to carry audio
without a **TURN server**; to add one, pass `config: { iceServers: [...] }` to `new Peer()` in `NetT` (`game.js`)
with your TURN credentials. iPhone Safari needs the microphone permission each visit unless it's allowed in
Settings.

## Tests

```
node tests/meta.test.js                           # rules: odds, boundaries, claims, unlocks, profiles (Node only)
sh build.sh path/to/peerjs.min.js                 # build dist/ first for the browser tests
node tests/e2e/progression.test.js                # 2-4 players in separate browsers: scaling, rewards, 5 chapters,
                                                  # unlocks, reconnect, takeover, grace period, persistence
node tests/e2e/voice.test.js                      # 3 players, fake microphones, real WebRTC audio
```

The browser tests use Playwright with stand-ins for the network services the test machine can't reach:
`tests/e2e/fake-room.js` (claude.ai room) and `tests/e2e/fake-peer.js` (PeerJS signalling; audio is real WebRTC).
Still to check by hand on real devices: voice over the internet between phones (NAT traversal), iPhone microphone
permissions, and the PeerJS public server.
