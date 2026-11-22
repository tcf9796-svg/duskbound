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
  Screen app also starts fresh. Use **Profile → Backup code** to copy a profile and **Restore** to load it
  elsewhere. Saves are repaired on load (`sanitizeProfile`), so a damaged or edited save can't break the game.
- Three ids, three jobs: **profile id** (who you are, persistent), **rejoin secret** (per session, issued privately by
  the host, proves you may reclaim your slot), **PeerJS/room peer id** (this connection only).

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
| Green | 30% | 0–2999 |
| Blue | 10% | 3000–3999 |
| Purple | 5% | 4000–4499 |
| Yellow | 2.5% | 4500–4749 |
| Red | 1% | 4750–4849 |
| No reward | 51.5% | 4850–9999 |

Then one item is picked from that rarity's pool (`REWARD_POOLS`), skipping items the player already owns or has
capped; if nothing is left, a same-rarity upgrade from `REWARD_FALLBACK` is given instead. "No reward" is final.

- **Per-player rolls:** the existing design had no chapter or party rewards (only in-run boons), so each player
  rolls separately.
- **Eligible:** everyone in the session when the chapter ends, including players inside their grace period (their
  result is delivered when they rejoin).
- **Claims:** keyed `runId:chapter:profileId`. The host keeps them for the session, and each device also records
  the claim ids it has applied. So duplicate completion events, reconnects and resends never roll or grant twice.
- **Categories:** upgrades (stackable stats, capped), starting talents (begin each run with one rank of a boon),
  weapons (one per hero, equipped in Profile) and characters.
- **Characters: pool empty.** No heroes exist beyond the three starters, which every profile already has. Adding
  one needs art, a kit and balancing; then list it as `c:<id>` in a pool.

## Reconnection

A guest who drops keeps their slot for `PARTY_SCALE.graceSeconds`. Rejoining needs **both** the private rejoin
secret the host gave that device and the same profile id. The host restores the same player object (health,
level, gold, boons, weapon, position next to a teammate), re-sends missed reward results, and never creates a
second copy. A failed takeover attempt is refused without disconnecting anyone. A second window from the same
device takes over its own slot; the old window is told why.

**Host migration is not supported.** If the host leaves or crashes, the run ends for everyone; guests can only
reconnect to a host that is still running.

## Campaign: five chapters

Chapters 1–3 are the original biomes. **Chapters 4–5 are placeholders:** new colour palettes ("The Frostfen",
"The Hollow Crown", marked `placeholder: true` in `data.js`, shown as "Chapter N (preview)") that reuse the
existing enemies and the Gloam Stag boss. Missing for them: unique enemy types, a new boss (or boss variants), map
features, music and art.

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
