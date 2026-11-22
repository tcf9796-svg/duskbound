'use strict';
// Language support: English (built in) and Traditional Chinese.
// Game logic and network messages stay in English; text is translated where it is drawn, so players in
// different languages can share a co-op game. T(s) returns s translated into the current language.
const ZH = {
  // heroes
  'Bramble': '荊棘', 'The Thorn Warden': '荊棘守衛',
  'A walking hedgerow in a bark mask. Slow to anger, impossible to uproot.': '戴著樹皮面具、會走路的樹籬。不輕易動怒，卻沒人能將它連根拔起。',
  '<b>Attack</b> — wide cudgel sweep': '<b>攻擊</b> — 大範圍棍棒橫掃',
  '<b>Skill</b> — Briar Ring: thorns burst out, slowing foes': '<b>技能</b> — 荊棘環：尖刺爆發，使敵人減速',
  '<b>Dash</b> — Shoulder charge that batters enemies': '<b>衝刺</b> — 肩撞衝鋒，重擊敵人',
  '<b>Ultimate</b> — Overgrowth: +50% damage, thorn pulses, hits heal': '<b>絕招</b> — 瘋長：傷害 +50%、荊棘脈衝、命中回血',
  '<b>Trait</b> — Daybloom: regenerates under the sun': '<b>特性</b> — 日華：在陽光下持續回血',
  'Sweep': '橫掃', 'Briar Ring': '荊棘環', 'Charge': '衝鋒', 'Overgrowth': '瘋長',
  'Wick': '燈芯', 'The Lantern Witch': '提燈女巫',
  'She bottled the last honest flame and has been lighting fools on fire ever since.': '她把最後一簇正直的火焰裝進瓶裡，從此專門點燃蠢貨。',
  '<b>Attack</b> — hurls cinder bolts': '<b>攻擊</b> — 投擲燼火彈',
  '<b>Skill</b> — Hang a lantern that scorches the ground': '<b>技能</b> — 掛起燈籠，灼燒地面',
  '<b>Dash</b> — Blink, leaving embers behind': '<b>衝刺</b> — 閃現，留下一路餘燼',
  '<b>Ultimate</b> — Cinderfall: a rain of burning stars': '<b>絕招</b> — 燼落：燃燒的星辰如雨落下',
  '<b>Trait</b> — Nightflame: +1 bolt after dark': '<b>特性</b> — 夜焰：入夜後火彈 +1',
  'Cinder Bolt': '燼火彈', 'Lantern': '燈籠', 'Blink': '閃現', 'Cinderfall': '燼落',
  'Vesper': '薇絲柏', 'The Moth Duelist': '蛾翼決鬥者',
  'Dust-winged and needle-quick. Drawn to the dark, not the light.': '鱗粉之翼，迅捷如針。她追逐的是黑暗，而非光明。',
  '<b>Attack</b> — rapid twin cuts; every third throws a blade': '<b>攻擊</b> — 快速雙刃連斬；每第三擊擲出飛刃',
  '<b>Skill</b> — Fan of piercing blades': '<b>技能</b> — 扇形射出穿透飛刃',
  '<b>Dash</b> — Two charges; cuts through foes': '<b>衝刺</b> — 兩次充能；穿身斬過敵人',
  '<b>Ultimate</b> — Eclipse: blink-strike up to 8 enemies': '<b>絕招</b> — 月蝕：閃擊最多 8 名敵人',
  '<b>Trait</b> — Moonlit: +15% crit and speed at night': '<b>特性</b> — 月照：夜晚暴擊率與速度 +15%',
  'Twin Cuts': '雙刃斬', 'Blade Fan': '刃扇', 'Flit': '掠影', 'Eclipse': '月蝕',
  // boons
  'Keen Edge': '銳刃', '+15% damage.': '傷害 +15%。',
  'Quick Hands': '快手', '+12% attack speed.': '攻擊速度 +12%。',
  'Fleet Foot': '疾足', '+8% movement speed.': '移動速度 +8%。',
  'Hearty': '強健', '+25 max health and heal 25.': '最大生命 +25，並回復 25。',
  'Sharp Eye': '銳眼', '+10% critical chance.': '暴擊率 +10%。',
  'Cruel Twist': '殘酷一擰', '+40% critical damage.': '暴擊傷害 +40%。',
  'Sapdrinker': '吸汁者', 'Heal for 3% of damage dealt.': '回復造成傷害的 3%。',
  'Ironbark': '鐵樹皮', 'Take 10% less damage.': '受到的傷害 -10%。',
  'Restless': '不安分', 'Cooldowns recover 12% faster.': '冷卻恢復速度加快 12%。',
  'Magpie': '喜鵲', '+60% pickup radius, +15% experience.': '拾取範圍 +60%，經驗 +15%。',
  'Second Step': '第二步', '+1 dash charge.': '衝刺次數 +1。',
  'Nightborn': '夜生', '+20% damage after dark.': '入夜後傷害 +20%。',
  'Sunkissed': '日吻', 'Regenerate 1.2 health per second by day.': '白天每秒回復 1.2 生命。',
  'Spite': '怨懟', 'When struck, lash out at everything nearby.': '受擊時，反擊周圍所有敵人。',
  'Stormtongue': '雷舌', 'Hits have a 20% chance to arc to 2 nearby foes.': '命中有 20% 機率連鎖至附近 2 名敵人。',
  'Nettle Venom': '蕁麻毒', 'Hits poison for 5 damage/sec over 3s.': '命中使敵人中毒，3 秒內每秒 5 點傷害。',
  'Mercy Stroke': '慈悲一擊', '+30% damage to foes below 30% health.': '對生命低於 30% 的敵人傷害 +30%。',
  'Banked Ember': '存燼', '+1 Ember (revives you on death).': '餘燼 +1（死亡時讓你復活）。',
  'Long Bough': '長枝', 'Sweep reach +30%.': '橫掃範圍 +30%。',
  'Barbed Ring': '倒刺環', 'Briar Ring: +50% damage, +20% radius.': '荊棘環：傷害 +50%，範圍 +20%。',
  'Bulwark': '壁壘', 'Charge heals 4 per enemy struck.': '衝鋒每擊中一名敵人回復 4 生命。',
  'Forked Flame': '分岔火焰', '+1 cinder bolt per cast.': '每次施放多 1 發燼火彈。',
  'White Heat': '白熱', 'Bolts pierce +1 enemy.': '火彈多穿透 1 名敵人。',
  'Great Lantern': '巨燈', 'Lantern: +25% radius, +2s duration.': '燈籠：範圍 +25%，持續時間 +2 秒。',
  'Blade Storm': '刃暴', 'Blade Fan throws +2 blades.': '刃扇多擲出 2 把飛刃。',
  'Ghoststep': '鬼步', 'Dash damage doubled; kills refund a dash.': '衝刺傷害加倍；擊殺返還一次衝刺。',
  'Lunar Edge': '月刃', 'Cut reach +15%, +20% critical damage.': '斬擊範圍 +15%，暴擊傷害 +20%。',
  'Boon': '祝福', 'Choose': '選擇',
  // unlockable heroes (Rowan, Mira, Vespera)
  "<b>Attack</b> — Briar Thrust: a long spear jab": "<b>攻擊</b> — 荊刺突：長矛突刺",
  "<b>Skill</b> — Root Snare: roots nearby foes in place": "<b>技能</b> — 根縛：將附近敵人定身",
  "<b>Space</b> — Shelterwood: a grove where allies take 35% less damage": "<b>空白鍵</b> — 庇護林：林中的隊友受到的傷害 -35%",
  "<b>Ultimate</b> — Ancient Sentinel: become a tree guardian; +35% armour, foes are drawn to you": "<b>絕招</b> — 遠古哨衛：化身樹之守護者；護甲 +35%，敵人會被你吸引",
  "<b>Trait</b> — Deep Roots: frontal hits are blocked by the shield (half damage) and store up to 5 charges for the next Root Snare": "<b>特性</b> — 深根：盾牌格擋正面攻擊（傷害減半），並儲存最多 5 層，強化下一次根縛",
  "Bark armour, a moss-heavy cloak and a shield that is still growing. Where Rowan plants a foot, the line holds.": "樹皮盔甲、厚苔斗篷，還有一面仍在生長的盾牌。羅文站定之處，防線便不會潰散。",
  "<b>Attack</b> — Shattered Cuts: a fast three-strike dagger combo": "<b>攻擊</b> — 碎鏡斬：快速的三段匕首連擊",
  "<b>Skill</b> — Mirror Exchange: swap places with your decoy, then shatter it": "<b>技能</b> — 鏡像交換：與分身交換位置，然後將其擊碎",
  "<b>Dash</b> — Reflection Step: dash through foes, leaving a decoy that draws them": "<b>衝刺</b> — 映步：穿過敵人衝刺，留下吸引敵人的分身",
  "<b>Ultimate</b> — Hall of Mirrors: three reflections repeat your cuts at 40% damage": "<b>絕招</b> — 鏡之迴廊：三道倒影以 40% 傷害重複你的斬擊",
  "<b>Trait</b> — Blind Spot: +40% damage to foes distracted by an ally or decoy": "<b>特性</b> — 盲點：對被隊友或分身吸引的敵人傷害 +40%",
  "A masked duelist in a coat of cracked mirror. Whatever you think you are fighting, it is not quite her.": "戴著面具、身穿碎鏡外衣的決鬥者。無論你以為自己在和什麼戰鬥，那都不完全是她。",
  "<b>Attack</b> — Ghostlight: a spectral bolt": "<b>攻擊</b> — 鬼火：發射幽靈光彈",
  "<b>Skill</b> — Guiding Wisp: shield the ally nearest your aim (yourself when solo). 30 energy": "<b>技能</b> — 引路幽光：為瞄準方向最近的隊友加上護盾（單人時為自己）。消耗 30 能量",
  "<b>Space</b> — Soul Tether: link up to 4 foes; 40% of direct damage to one spreads to the rest. 30 energy": "<b>空白鍵</b> — 魂鏈：連結最多 4 名敵人；對其中一名的直接傷害有 40% 擴散至其他人。消耗 30 能量",
  "<b>Ultimate</b> — Midnight Procession: spirits march toward your aim, harming foes and healing allies": "<b>絕招</b> — 午夜行列：亡魂朝瞄準方向前進，傷害敵人並治療隊友",
  "<b>Trait</b> — Lingering Light: the fallen leave embers that restore lantern energy": "<b>特性</b> — 殘光：倒下的敵人會留下恢復燈籠能量的餘燼",
  "A cloaked traveller swinging a haunted lantern on a chain. The lost follow her light; so does everything else.": "披著斗篷的旅人，鏈上搖晃著一盞鬧鬼的燈籠。迷途者追隨她的光，其他東西也是。",
  "Rowan": "羅文",
  "The Thornwarden": "棘盾衛士",
  "Mira": "米拉",
  "The Mirrorblade": "鏡刃",
  "Vespera": "薇斯佩拉",
  "The Lanternkeeper": "守燈人",
  "Briar Thrust": "荊刺突",
  "Root Snare": "根縛",
  "Shelterwood": "庇護林",
  "Ancient Sentinel": "遠古哨衛",
  "Shattered Cuts": "碎鏡斬",
  "Mirror Exchange": "鏡像交換",
  "Reflection Step": "映步",
  "Hall of Mirrors": "鏡之迴廊",
  "Ghostlight": "鬼火",
  "Guiding Wisp": "引路幽光",
  "Soul Tether": "魂鏈",
  "Midnight Procession": "午夜行列",
  "Thicket": "灌木叢",
  "Shelterwood: +25% radius, +2s duration.": "庇護林：範圍 +25%，持續時間 +2 秒。",
  "Taproot": "主根",
  "Root Snare roots 0.5s longer and deals +40% damage.": "根縛定身時間延長 0.5 秒，傷害 +40%。",
  "Many Facets": "多重鏡面",
  "Decoys last +2s; their shatter deals +40% damage.": "分身持續時間 +2 秒；碎裂傷害 +40%。",
  "Cold Glint": "冷光",
  "Blind Spot bonus +20%.": "盲點加成 +20%。",
  "Deep Wick": "深芯",
  "+25 maximum lantern energy, +1 energy per second.": "燈籠能量上限 +25，每秒 +1 能量。",
  "Kindred Flame": "同源之火",
  "Guiding Wisp shields are 50% stronger.": "引路幽光的護盾強化 50%。",
  "Deep Roots": "深根",
  "Decoy standing": "分身存在中",
  "No decoy — dash to leave one": "沒有分身 — 衝刺可留下分身",
  "Shield": "護盾",
  "NO DECOY": "無分身",
  "LOW": "能量不足",
  "SKILL 2": "技能 2",
  "Absorbed": "吸收",
  "Blocked": "格擋",
  "Needs two foes to tether": "需要兩名敵人才能連結",
  "No ally to guide": "沒有可引導的隊友",
  "The wood rallies to you.": "森林為你集結。",
  // places
  'The Thornwood': '荊棘林', 'The Drowned Mire': '沉溺沼澤', 'The Ashen Reach': '灰燼荒原', 'The Frostfen': '霜沼', 'The Hollow Crown': '空洞王冠',
  // difficulties, rarities, weapons, upgrades
  'Normal': '普通', 'Nightmare': '夢魘', 'Hell': '地獄', 'Inferno': '煉獄',
  'Green': '綠色', 'Blue': '藍色', 'Purple': '紫色', 'Yellow': '黃色', 'Red': '紅色',
  'Thornmaul': '荊棘巨槌', 'Elder Bough': '古老樹枝', 'Gloam Antler': '幽暮鹿角', 'Cinderglass Lantern': '燼玻璃燈', 'Sun Lantern': '太陽燈籠', 'Starwick': '星芯',
  'Mothfang Blades': '蛾牙雙刃', 'Dusk Needles': '暮色細針', 'Eclipse Edge': '蝕月之刃',
  '+15% damage, -8% attack speed': '傷害 +15%，攻擊速度 -8%', 'Sweep reach +30%, +10% damage': '橫掃範圍 +30%，傷害 +10%', '+25% damage, +10% critical chance': '傷害 +25%，暴擊率 +10%',
  'Bolts pierce +1 enemy': '火彈多穿透 1 名敵人', '+1 cinder bolt per cast': '每次施放多 1 發燼火彈', '+20% damage, cooldowns 15% faster': '傷害 +20%，冷卻加快 15%',
  '+8% critical chance': '暴擊率 +8%', '+1 dash charge, +10% move speed': '衝刺次數 +1，移動速度 +10%', '+20% damage, +40% critical damage': '傷害 +20%，暴擊傷害 +40%',
  'Max health': '最大生命', 'Damage': '傷害', 'Move speed': '移動速度', 'Critical chance': '暴擊率', 'Starting gold': '初始金幣',
  'No reward': '沒有獎勵', 'Could not reach the matchmaking server. Check your internet connection and try again.': '無法連上配對伺服器。請檢查網路連線後再試一次。',
  'This browser can’t make direct connections for co-op. Try Safari or Chrome.': '此瀏覽器無法建立合作模式所需的直接連線，請改用 Safari 或 Chrome。',
  'The direct connection to the host failed. Both players should be on the internet (not only local Wi-Fi) and try again.': '與房主的直接連線失敗。請確認雙方都已連上網路後再試一次。', 'Keepsake (everything already owned)': '紀念品（已擁有全部）', 'That profile is already in this party.': '這個檔案已經在隊伍中了。',
  // banners and floating text
  'THE GLOAM STAG': '幽暮雄鹿', 'It has come for what you carry.': '它為你身上之物而來。',
  'An Ember rekindles you': '餘燼讓你重燃', 'Stand beside them to revive.': '站到旁邊即可救起。',
  'Ultimate unlocks at level 3': '絕招於 3 級解鎖', 'Night falls': '夜幕降臨', 'The wood wakes hungry.': '森林在飢餓中甦醒。',
  'A little light. Use it.': '一點光亮，好好利用。', 'Sigil claimed': '取得印記', 'Ultimate unlocked': '絕招已解鎖', 'Press Q': '按 Q 或 ULT',
  'Blessing of Teeth': '利齒祝福', 'Blessing of Root': '根系祝福', 'Blessing of Wind': '疾風祝福',
  '+8% damage': '傷害 +8%', '+15 max health': '最大生命 +15', '+5% speed, +4% crit': '速度 +5%，暴擊 +4%',
  'Not enough gold': '金幣不足', "The Peddler's wares": '行商的貨品', 'Day 1 — find the camps, caches and shrines.': '第 1 天 — 找出營地、寶箱與神龕。',
  // map prompts
  'Wake the Gloam Stag early': '提早喚醒幽暮雄鹿', 'Unsealing': '解封中', 'Drink from the spring': '飲用泉水', 'Open cache': '開啟寶箱', 'Pray at the wayshrine': '在路旁神龕祈禱',
  // HUD
  'The Gloam Stag hunts you': '幽暮雄鹿正在獵殺你', 'LMB': '左鍵', 'RMB': '右鍵', 'SPACE': '空白鍵', 'DOWN': '倒地',
  'SKILL': '技能', 'DOWN — an ally must reach you': '倒地 — 等待隊友前來救援', 'DOWN — stand close to revive': '倒地 — 靠近即可救起', 'AUTO': '自動', 'AUTO ✓': '自動 ✓', 'Auto attack': '自動攻擊', 'Auto attack on': '自動攻擊：開', 'Auto attack off': '自動攻擊：關', 'on': '開', 'off': '關', 'TALK': '說話', 'DASH': '衝刺', 'ULT': '絕招', 'USE': '使用', 'Lv 3': '3 級',
  // messages
  'Online co-op is not available on this page. Solo works here; for co-op, open the downloaded duskbound.html file or a copy on your own website.': '此頁面無法進行線上合作。可以單人遊玩；合作模式請開啟下載的 duskbound.html 檔案或架在你自己網站上的版本。',
  'Online play needs an internet connection (the networking library did not load).': '線上遊玩需要網路連線（連線函式庫未能載入）。',
  'Co-op here needs you signed in to claude.ai. Sign in to claude.ai in this browser, then open the page link again. (Solo works without signing in.)': '在這裡進行合作需要登入 claude.ai。請在此瀏覽器登入 claude.ai 後重新開啟頁面連結。（單人模式不需登入。）',
  'Live rooms are not available in this view. Open the page link directly in Safari or Chrome while signed in to claude.ai — not through a public share link, and not inside another app.': '此畫面無法使用即時房間。請登入 claude.ai 後，直接在 Safari 或 Chrome 開啟頁面連結 — 不要透過公開分享連結，也不要在其他 App 內開啟。',
  'Only the page owner, or people given Edit or Contribute access, can host here. You can still join a room.': '只有頁面擁有者或具有編輯／貢獻權限的人能在這裡開房。你仍然可以加入房間。',
  'This page is not allowed to open live rooms for you.': '此頁面無法為你開啟即時房間。', 'Too many rooms are open right now. Try again in a minute.': '目前開啟的房間太多，請稍後再試。',
  'The live connection did not answer. Try again.': '即時連線沒有回應，請再試一次。',
  'That party has already set out. Ask the host to return to the lobby.': '這支隊伍已經出發了。請房主回到大廳。', 'That party is full (4 players).': '這支隊伍已滿（4 人）。', 'You rejoined this game from another window.': '你已從另一個視窗重新加入這場遊戲。',
  'Enter the 5-character room code from your host.': '請輸入房主提供的 5 碼房間代碼。', 'Lost connection to the host. Tap Join to rejoin the game.': '與房主的連線中斷。點「加入」即可重新加入遊戲。',
  // rotate screen
  'Turn your phone sideways': '請將手機橫放', 'Duskbound plays best in landscape.': '橫向畫面遊玩效果最佳。', 'Play upright anyway': '仍要直向遊玩'
};
// Text built from parts: [English pattern, Chinese template using $1, $2...]
const ZH_RX = [
  [/^Day (\d+)$/, '第 $1 天'], [/^Level (\d+)$/, '等級 $1'], [/^Chapter (\d+)$/, '第 $1 章'], [/^(\d+) remaining$/, '剩餘 $1'],
  [/^Buy a boon — (\d+) gold$/, '購買祝福 — $1 金幣'], [/^(.+) has fallen$/, '$1 倒下了'], [/^(.+) is back up$/, '$1 重新站起來了'],
  [/^(.+) left the party$/, '$1 離開了隊伍'], [/^Stand in the ring for (\d+(?:\.\d+)?) s to unseal the Gloam Stag$/, '站在法陣中 $1 秒即可解封幽暮雄鹿'], [/^Blocked · root (\d+)$/, '格擋 · 深根 $1'], [/^Deep Roots ×(\d+)$/, '深根 ×$1'], [/^Character: (.+)$/, '角色：$1'], [/^(Green|Blue|Purple|Yellow|Red) reward$/, '$1獎勵'], [/^(.+) unlocked$/, '已解鎖$1'], [/^Campaign cleared on (.+)$/, '已通關$1難度'],
  [/^Weapon: (.+)$/, '武器：$1'], [/^Starting talent: (.+)$/, '初始天賦：$1'], [/^Upgrade: (.+?) (\+\d+%?)$/, '強化：$1 $2'], [/^Chapter (\d+) \(preview\)$/, '第 $1 章（預覽）'],
  [/^(.+)'s place was released$/, '$1 的位置已釋出'], [/^They can rejoin with room code (\S+) within (\d+) min$/, '可在 $2 分鐘內用房間代碼 $1 重新加入'], [/^(.+) lost connection$/, '$1 連線中斷'], [/^(.+) rejoined the party$/, '$1 重新加入了隊伍'],
  [/^They can rejoin with room code (.+)$/, '可用房間代碼 $1 重新加入'], [/^No room found with code (.+)\.$/, '找不到代碼為 $1 的房間。'],
  [/^Could not reach room (.+)\.$/, '無法連上房間 $1。'], [/^Connection failed \((.+)\)\.$/, '連線失敗（$1）。'],
  [/^Could not open a room \((.+)\)\. Check your connection and try again\.$/, '無法開啟房間（$1）。請檢查網路後再試一次。'],
  [/^DASH (\d+)$/, '衝刺 $1'], [/^Wanderer (\d+)$/, '旅人 $1']
];
const LANGS = ['en', 'zh'];
let LANG = (() => {
  try { const s = localStorage.getItem('duskbound-lang'); if (LANGS.includes(s)) return s; } catch (e) { }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return /^zh-(tw|hk|mo|hant)/i.test(nav) ? 'zh' : 'en';
})();
function T(s) {
  if (LANG !== 'zh' || typeof s !== 'string' || !s) return s;
  if (Object.prototype.hasOwnProperty.call(ZH, s)) return ZH[s];
  for (const [rx, to] of ZH_RX) if (rx.test(s)) return s.replace(rx, (m, ...g) => to.replace(/\$(\d)/g, (_, i) => T(g[i - 1])));
  return s;
}
// Pick by language for whole sentences built in code: L('English', '中文').
const L = (en, zh) => LANG === 'zh' ? zh : en;
function setLang(l) {
  if (!LANGS.includes(l)) return; LANG = l;
  try { localStorage.setItem('duskbound-lang', l); } catch (e) { }
  applyStaticLang();
}
function applyStaticLang() {
  document.documentElement.lang = LANG === 'zh' ? 'zh-Hant' : 'en';
  const r = document.getElementById('rotate'); if (!r) return;
  const set = (sel, en) => { const el = r.querySelector(sel); if (el) el.textContent = T(en); };
  set('.rt1', 'Turn your phone sideways'); set('.rt2', 'Duskbound plays best in landscape.'); set('#rotok', 'Play upright anyway');
}
applyStaticLang();
