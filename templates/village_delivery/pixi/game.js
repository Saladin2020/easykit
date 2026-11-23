// Easy Kit glue for the village_delivery template — PixiJS v8 build. MIT © Salahuddin Benno.
// Every asset and runtime comes from an Easy tool export in its own folder:
//   tilemap/ (Easy Tilemap + Easy Sprite cast) · dialogue/ · quest/ · ui/ · sfx/ · fx/ · music/ · anim/ · items/ · save/
// Optional, when kit.json lists them in `features`: portrait/ (Easy Portrait blink + talk) · npc/ (Easy NPC schedules +
//   clock) · font/ (Easy Font มะขาม pixel text) · battle/ (Easy Battle paddy-field encounters).
// Keys: arrows / WASD walk · E / Enter / Space talk · L language · F5 save · F9 load · Esc skip / close.
import { loadTilemap } from "./tilemap/easytilemap-pixi.js";
import { loadDialogue, DialogueBox } from "./dialogue/easydialogue-pixi.js";
import { QuestManager } from "./quest/easyquest-manager.js";
import { loadUi } from "./ui/easyui-pixi.js";
import { SfxBank } from "./sfx/easysfx-pixi.js";
import { loadFx } from "./fx/easyfx-pixi.js";
import { loadMusic } from "./music/easymusic-web.js";
import { loadCutscene } from "./anim/easyanim-pixi.js";
import { loadItems } from "./items/easyitems-pixi.js";
import { loadEasySave } from "./save/easysave-web.js";

const W = 480;
const H = 270;
const SPEED = 72;
const TALK_RANGE = 28;
const SLOT = "quick";
const THAI = /[\u0E01-\u0E3A\u0E40-\u0E5B]/;
const DAYS = {
  th: { mon: "จันทร์", tue: "อังคาร", wed: "พุธ", thu: "พฤหัสฯ", fri: "ศุกร์", sat: "เสาร์", sun: "อาทิตย์" },
  en: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
  ms: { mon: "Isnin", tue: "Selasa", wed: "Rabu", thu: "Khamis", fri: "Jumaat", sat: "Sabtu", sun: "Ahad" },
};

export async function startGame(PIXI, mount) {
  PIXI.TextureSource.defaultOptions.scaleMode = "nearest";
  const kit = await (await fetch("kit/kit.json")).json();
  const app = new PIXI.Application();
  await app.init({ width: W, height: H, resolution: 3, antialias: false, background: "#140e0a", roundPixels: true });
  app.canvas.style.width = "";
  mount.append(app.canvas);

  // ---------------------------------------------------------------- tools
  const es = await loadEasySave("save");
  const { i18n, saves } = es;
  if (!es.storage.get("locale")) es.setLocale(kit.defaultLocale ?? "th");
  const T = (k, p) => i18n.t(k, p);
  const ui = await loadUi(PIXI, "ui/easyui.atlas.json");
  await Promise.all([document.fonts.load('12px "Kanit"'), document.fonts.load('12px "Kanit Medium"')]).catch(() => undefined);
  const map = await loadTilemap(PIXI, kit.world);
  const questDoc = await (await fetch(kit.questFile)).json();
  let manager = new QuestManager(questDoc);
  const itemsKit = await loadItems(PIXI, "items/easyitems.json");
  const inv = itemsKit.inventory;
  const bank = await SfxBank.load("sfx/easysfx.manifest.json", { sound: null });
  const fx = await loadFx(PIXI, "fx/easyfx.json");
  const music = await loadMusic("music/easymusic.json");
  const titleTex = await PIXI.Assets.load(kit.titleImage);
  const sfx = (id, volume = 1) => { if (bank.has(id)) bank.play(id, { volume }).catch?.(() => undefined); };
  // optional tools: loaded only when this build has them
  const feat = kit.features ?? {};
  const ef = feat.font ? await (await import("./font/easyfont-pixi.js")).loadEasyFonts(PIXI, "font/fonts/fonts.json") : null;
  const plib = feat.portrait ? await (await import("./portrait/easyportrait-pixi.js")).loadPortraits(PIXI, "portrait/portraits.json") : null;
  const npcRt = feat.npc ? await (await import("./npc/easynpc-pixi.js")).loadNpcs(PIXI, "npc/easynpc.world.json") : null;
  const eb = feat.battle ? await (await import("./battle/easybattle-pixi.js")).loadBattle(PIXI, "battle/easybattle.json") : null;

  // ---------------------------------------------------------------- layers
  const worldLayer = new PIXI.Container();
  const hudLayer = new PIXI.Container();
  const dialogueLayer = new PIXI.Container();
  const shopLayer = new PIXI.Container();
  const cutLayer = new PIXI.Container();
  const titleLayer = new PIXI.Container();
  app.stage.addChild(worldLayer, hudLayer, dialogueLayer, shopLayer, cutLayer, titleLayer);
  worldLayer.addChild(map.view);

  const player = map.characters.get(kit.player);
  const ctl = map.control(kit.player, { speed: SPEED });
  map.follow(player.sprite, W, H);
  const npcs = new Map([...map.characters].filter(([n]) => n !== kit.player));

  const state = { mode: "boot", near: "", segment: "", flags: {}, lastQuestCoins: Number(manager.vars.coins ?? 0), playtime: 0, saves: 0, maxMoney: 0, events: [] };
  const npcName = (id) => T(`kit.npc.${id}.name`);
  const npcFor = (speaker) => Object.keys(kit.npcs).find((n) => kit.npcs[n].speaker === speaker) ?? "";
  const q = kit.quest.main;

  // ---------------------------------------------------------------- Easy Font: มะขาม pixel text for HUD-sized labels
  /** Like ui.text (x, y = baseline, size, align) but in the pixel font with a 1px shadow; big titles stay in Kanit. */
  function ftext(str, o = {}) {
    if (!ef || (o.size ?? 10) > 12) return ui.text(str, o);
    const id = (o.size ?? 10) <= 9 ? kit.font.small : kit.font.hud;
    const f = ef.fonts[id];
    const c = new PIXI.Container();
    const shadow = ef.text("", { font: id, fill: 0x1a120c });
    const t = ef.text("", { font: id, fill: o.fill ?? 0xf7ebd3 });
    const ax = o.align === "center" ? 0.5 : o.align === "right" ? 1 : 0;
    for (const x of [shadow, t]) x.anchor?.set?.(ax, 0);
    shadow.position.set(1, 1);
    c.addChild(shadow, t);
    c.position.set(Math.round(o.x ?? 0), Math.round((o.y ?? 0) - f.baseline));
    c.__raw = "";
    c.__pixel = id;
    c.setText = (s) => {
      c.__raw = s;
      const shaped = o.wrap ? ef.wrap(s, id, o.wrap) : ef.shape(s);
      shadow.text = shaped;
      t.text = shaped;
    };
    c.setText(str);
    return c;
  }

  // ---------------------------------------------------------------- HUD
  const coinPanel = ui.panel({ x: W - 96, y: 6, w: 90, h: 22 });
  const coinIcon = ui.icon("coin");
  coinIcon.position.set(W - 92, 9);
  const coinText = ftext("", { x: W - 12, y: 21, size: 10, align: "right" });
  const questPanel = ui.panel({ x: W - 186, y: 32, w: 180, h: ef ? 38 : 34 });
  const questTitle = ftext("", { x: W - 178, y: ef ? 44 : 45, size: 9, title: true });
  const questText = ftext("", { x: W - 178, y: ef ? 60 : 59, size: 8 });
  const prompt = ftext("", { x: W / 2, y: 214, size: 10, align: "center" });
  const toast = ftext("", { x: W / 2, y: 124, size: 11, align: "center" });
  const clockText = ftext("", { x: 8, y: 18, size: 10 });
  clockText.visible = !!npcRt;
  hudLayer.addChild(coinPanel, coinIcon, coinText, questPanel, questTitle, questText, prompt, toast, clockText);
  let toastLeft = 0;
  const setText = (t, s) => (t.setText ? t.setText(s) : (t.text = s));
  const getText = (t) => t.__raw ?? (t.children?.length ? t.children[t.children.length - 1].text : t.text) ?? "";
  function showToast(s, secs = 2.2) { setText(toast, s); toastLeft = secs; }

  function questLines() {
    const st = manager.status(q);
    if (st === "active") {
      const cur = manager.currentStep(q);
      return [T(`quest.${q}.title`), interpolate(T(`quest.${q}.step.${cur?.id ?? "report"}`))];
    }
    if (st === "completed") return [T(`quest.${q}.title`), T("kit.quest.done")];
    return [T("kit.quest.label"), T("kit.quest.none")];
  }
  const interpolate = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (manager.vars[k] !== undefined ? String(manager.vars[k]) : m));
  function refreshHud() {
    setText(coinText, T("kit.coins", { n: inv.state.coins }));
    state.maxMoney = Math.max(state.maxMoney, inv.state.coins);
    const [a, b] = questLines();
    setText(questTitle, a);
    setText(questText, b);
  }
  function refreshPrompt() {
    if (state.mode !== "play" || !state.near) return setText(prompt, "");
    const role = kit.npcs[state.near]?.role ?? "bark";
    setText(prompt, T(role === "shop" ? "kit.prompt.shop" : "kit.prompt.talk", { name: npcName(state.near) }));
  }
  function refreshTexts() {
    refreshHud();
    refreshPrompt();
    if (titleLayer.children.length) fillTitle();
  }

  // ---------------------------------------------------------------- dialogue + quest
  let box = null;
  async function loadBox() {
    const loc = i18n.locale;
    const bundle = await loadDialogue(PIXI, kit.dialogueFiles[loc] ?? kit.dialogueFiles.th);
    if (box) box.view.destroy({ children: true });
    box = new DialogueBox(PIXI, bundle, {
      variables: { ...manager.vars },
      onEvent: (n, a, r) => {
        manager.emit(n, a, r.vars);
        Object.assign(r.vars, manager.vars);
        if (n === "sfx" && a[0]) sfx(a[0]);
      },
      onLine: (ev) => (talkPortrait(ev), sfx({ kid: "blip_kid", vendor: "blip_auntie", monk: "blip_monk", elder: "blip_elder" }[ev.speaker] ?? "blip_mid", 0.4)),
      onEnd: (vars) => finishSegment(vars),
    });
    box.view.visible = false;
    dialogueLayer.addChild(box.view);
    if (ef && box.doc.ui?.kitFont) pixelBox(box, box.doc.ui.kitFont);
    talker = null;
    talkers.clear(); // their containers went with the old box
  }

  /** Swap the dialogue box's Kanit texts for the Easy Font pixel font (the dialogue text was shaped at build time). */
  function pixelBox(b, fid) {
    const f = ef.fonts[fid];
    const mk = (fill) => {
      const t = new PIXI.BitmapText({ text: "", style: { fontFamily: f.family, fontSize: f.size, fill } });
      t.roundPixels = true;
      t.pivot.y = f.bitmap.baseLineOffset ?? 0;
      return t;
    };
    const swap = (key, t) => {
      const old = b[key];
      b.view.addChildAt(t, b.view.getChildIndex(old));
      old.destroy();
      b[key] = t;
    };
    swap("body", mk(b.C.text));
    swap("nameText", mk(b.C.plateText));
    const L = b.L;
    const showLine = b.showLine.bind(b);
    b.showLine = (ev) => {
      const onLine = b.opts.onLine;
      b.opts.onLine = null;
      showLine(ev);
      b.opts.onLine = onLine;
      const ps = L.portrait.size;
      const pad = L.portrait.pad;
      const right = ev.side === "right";
      let textX = L.box.x + L.text.padX;
      let textW = L.box.w - L.text.padX * 2;
      if (b.portrait.visible) {
        if (!right) textX = b.portrait.x + ps + pad + 3;
        textW = L.box.w - (ps + pad * 2 + 3) - L.text.padX;
      }
      b.fullText = ef.wrap(ev.text, fid, textW).split("\n").slice(0, L.text.maxLines).join("\n");
      b.clusters = [...b.fullText];
      b.total = b.clusters.length;
      b.revealed = 0;
      b.body.text = "";
      b.body.position.set(Math.round(textX), L.box.y + L.text.padY + (ev.name ? 4 : 0) - 3);
      if (ev.name) {
        b.nameText.text = ef.shape(ev.name); // names arrive unshaped from scripts; the bitmap font has no plain combining marks
        const pw = Math.ceil(b.nameText.width + L.plate.padX * 2);
        b.plate.width = pw;
        b.nameText.position.set(Math.round(b.plate.x + L.plate.padX), Math.round(b.plate.y + (L.plate.h - f.line) / 2));
        b.plateBar.clear();
        if (ev.color) b.plateBar.rect(b.plate.x + 3, b.plate.y + L.plate.h - 4, pw - 6, 1).fill(ev.color);
      }
      onLine?.(ev);
    };
    const showChoices = b.showChoices.bind(b);
    b.showChoices = (ev) => {
      showChoices(ev);
      const C2 = L.choices;
      const w = Math.ceil(Math.max(C2.minW, ...ev.options.map((o) => ef.measure(o.text, fid) + C2.padX + 14)));
      b.choicePanel.x = L.box.x + L.box.w - w;
      b.choicePanel.children[0].width = w;
      b.choiceW = w;
      b.rows = b.rows.map((old, i) => {
        const t = mk(b.C.choice);
        t.text = ev.options[i].text;
        t.position.set(C2.padX, C2.padY + i * C2.rowH + Math.round((C2.rowH - f.line) / 2));
        t.eventMode = "static";
        t.cursor = "pointer";
        t.on("pointerover", () => { if (!ev.options[i].disabled) b.select(i); });
        t.on("pointertap", () => b.choose(i));
        b.choicePanel.addChildAt(t, b.choicePanel.getChildIndex(old));
        old.destroy();
        return t;
      });
      b.select(0);
    };
  }

  // ---------------------------------------------------------------- Easy Portrait: blink + talk over the dialogue box
  let talker = null;
  const talkers = new Map();
  async function talkPortrait(ev) {
    if (!plib || !box) return;
    const pid = ev.portrait;
    if (talker) talker.container.visible = false;
    if (!pid || !plib.index.portraits.some((x) => x.id === pid)) return;
    let p = talkers.get(pid);
    try {
      if (!p) {
        p = await plib.portrait(pid, { emotion: ev.emotion ?? "neutral" });
        talkers.set(pid, p);
      } else await p.setEmotion(ev.emotion ?? "neutral");
    } catch {
      return;
    }
    if (box.line !== ev) return;
    if (p.container.parent !== box.view) box.view.addChildAt(p.container, box.view.getChildIndex(box.portrait) + 1);
    const s = box.L.portrait.size / (p.sprite.texture.width || box.L.portrait.size);
    p.sprite.scale.set(s);
    p.container.position.set(box.portrait.x, box.portrait.y);
    p.container.visible = box.portrait.visible;
    box.portrait.alpha = p.container.visible ? 0 : 1;
    p.say(Math.min(4, Math.max(0.4, String(ev.text ?? "").length / 40)));
    talker = p;
    state.events.push(`portrait:${pid}`);
  }

  manager.on((name, ...args) => {
    if (name === "flag_changed" && args[0] === "coins") {
      const delta = Number(args[1]) - state.lastQuestCoins;
      state.lastQuestCoins = Number(args[1]);
      if (delta > 0) {
        inv.state.coins += delta;
        inv.emit?.();
        sfx("coin");
        spawnFx("coin_burst", player.sprite.x, player.sprite.y - 28);
      }
    } else if (name === "item_changed") {
      const [id, count] = args;
      if (inv.items.has(id)) {
        const diff = count - inv.count(id);
        if (diff > 0) inv.add(id, diff);
        else if (diff < 0) inv.remove(id, -diff);
      }
    } else if (name === "step_completed") {
      state.events.push(`step:${args[0]}.${args[1]}`);
      showToast(T("kit.quest.step", { step: T(`quest.${args[0]}.step.${args[1]}`) }));
      sfx("confirm");
      spawnFx("heal_plus", player.sprite.x, player.sprite.y - 24);
    } else if (name === "quest_completed") {
      state.events.push(`complete:${args[0]}`);
      if (args[0] === q) {
        showToast(T("kit.quest.done"), 3);
        sfx("powerup");
        spawnFx("level_up", player.sprite.x, player.sprite.y - 24);
        spawnFx("confetti", player.sprite.x, player.sprite.y - 40);
      }
    } else if (name === "quest_event" && args[0] === "sfx") sfx(args[1]?.[0]);
    if (name === "changed" || name === "step_completed" || name === "quest_completed") refreshHud();
  });

  function segmentFor(speaker) {
    const st = manager.status(q);
    const step = manager.currentStep(q)?.id ?? "";
    if (speaker === "vendor") {
      if (st === "available" || st === "locked" || (st === "active" && step === "accept")) return "market";
      if (st === "completed" && !state.flags.ending_seen) return "ending";
    }
    if (speaker === "monk" && st === "active" && step === "temple") return "temple";
    if (speaker === "farmer" && st === "active" && step === "farm") return "farm";
    if (speaker === "elder" && st === "active" && step === "elder") return "elder";
    return "";
  }

  function questTarget() {
    const st = manager.status(q);
    if (st === "completed") return state.flags.ending_seen ? "" : npcFor("vendor");
    if (st !== "active") return npcFor("vendor");
    return { accept: npcFor("vendor"), temple: npcFor("monk"), farm: npcFor("farmer"), elder: npcFor("elder") }[manager.currentStep(q)?.id] ?? "";
  }

  let marker = null;
  function markTarget() {
    marker?.destroy?.();
    marker = null;
    const t = questTarget();
    const n = npcs.get(t);
    if (n) marker = spawnFx("sparkle_shine", n.sprite.x, n.sprite.y - 52, { loop: true });
  }

  function spawnFx(id, x, y, o = {}) {
    if (!kit.fx.includes(id)) return null;
    const s = fx.play(map.world, id, x, y, o);
    if (s) s.zIndex = 100000;
    return s;
  }

  function startSegment(seg) {
    state.segment = seg;
    state.events.push(`dialogue:${seg}`);
    Object.assign(box.runner.vars, manager.vars);
    setMode("dialogue");
    box.state = "ready"; // DialogueBox.start() keeps "end" from the previous segment otherwise
    box.start(seg);
  }

  function finishSegment(vars) {
    manager.emit("segment", [state.segment], vars);
    if (state.segment === "ending") state.flags.ending_seen = true;
    state.segment = "";
    setMode("play");
    markTarget();
    refreshTexts();
  }

  function interact(npc = state.near) {
    const info = kit.npcs[npc];
    if (!npc || !info) return "";
    if (info.speaker) manager.emit("talk", [info.speaker]);
    if (info.role === "shop") return openShop(info.shop ?? kit.shop), "shop";
    if (info.role === "quest") {
      const seg = segmentFor(info.speaker);
      if (seg) return startSegment(seg), `dialogue:${seg}`;
    }
    bark(npc);
    return "bark";
  }

  function bark(npc) {
    state.events.push(`bark:${npc}`);
    let text = T(`kit.npc.${npc}.bark`);
    if (kit.npcs[npc].speaker === "vendor" && manager.status(q) === "active") {
      const step = manager.currentStep(q)?.id ?? "";
      const hint = `quest.${q}.step.${step}.hint`;
      text = T(hint) !== hint ? T(hint) : T(`quest.${q}.step.${step}`);
    }
    const nid = scheduled.get(npc);
    if (nid && npcRt) {
      const nn = npcRt.world.npcs.find((x) => x.id === nid);
      npcRt.engine.talk(nn, (clock.bonds[nid] ??= npcRt.engine.newBond(nn)), clock.day);
      const st = npcRt.engine.state(npcRt.world, nid, clock.day, clock.minute);
      const act = npcRt.world.activities[st.activity];
      if (act) text += `\n(${act[i18n.locale] ?? act.en})`;
    }
    const n = npcs.get(npc);
    let lines;
    let h;
    let bubble;
    if (ef) {
      const t = ftext(text, { x: 6, y: 18, size: 8, wrap: 148 });
      const nl = ef.wrap(text, kit.font.small, 148).split("\n").length;
      h = 10 + nl * ef.fonts[kit.font.small].line;
      bubble = ui.panel({ x: 0, y: 0, w: 160, h, small: true });
      bubble.addChild(t);
    } else {
      lines = ui.wrap(text, 150, 8);
      h = 10 + lines.length * 11;
      bubble = ui.panel({ x: 0, y: 0, w: 160, h, small: true });
      lines.forEach((l, i) => bubble.addChild(ui.text(l, { x: 6, y: 13 + i * 11, size: 8 })));
    }
    bubble.position.set(Math.round(n.sprite.x - 80), Math.round(n.sprite.y - 60 - h));
    bubble.zIndex = 100001;
    map.world.addChild(bubble);
    sfx("blip_mid", 0.5);
    setTimeout(() => bubble.destroy({ children: true }), 2800);
  }

  // ---------------------------------------------------------------- shop
  let shop = null;
  function openShop(id) {
    state.events.push(`shop:${id}`);
    shop = itemsKit.shopPanel(id, {
      lang: i18n.locale,
      onTrade: (kind, item, r) => {
        if (!r.ok) return sfx("hurt", 0.6);
        state.events.push(`${kind}:${item}`);
        sfx("coin");
        showToast(T("kit.toast.bought", { item: inv.name(item, i18n.locale) }));
        refreshHud();
      },
    });
    const k = Math.min(1, (W - 16) / shop.width, (H - 16) / shop.height);
    shop.scale.set(k);
    shop.position.set(Math.round((W - shop.width) / 2), Math.round((H - shop.height) / 2));
    shopLayer.addChild(shop);
    setMode("shop");
    music.play(kit.music.shop, { fade: 0.6 }).catch(() => undefined);
  }
  function closeShop() {
    shop?.destroy({ children: true });
    shop = null;
    setMode("play");
    music.play(kit.music.world, { fade: 0.6 }).catch(() => undefined);
    refreshHud();
  }

  // ---------------------------------------------------------------- title + cutscene
  let titleTexts = null;
  function showTitle() {
    setMode("title");
    titleLayer.removeChildren();
    const bg = new PIXI.Sprite(titleTex);
    bg.width = W;
    bg.height = H;
    const shade = new PIXI.Graphics().rect(0, 150, W, 120).fill({ color: 0x0d0805, alpha: 0.5 });
    titleTexts = {
      title: ui.text("", { x: W / 2, y: 182, size: 22, align: "center", title: true }),
      press: ftext("", { x: W / 2, y: 204, size: 12, align: "center" }),
      lang: ftext("", { x: W / 2, y: 222, size: 10, align: "center" }),
      keys: ftext("", { x: W / 2, y: 244, size: 9, align: "center" }),
      cont: ftext("", { x: W / 2, y: 260, size: 9, align: "center" }),
    };
    titleLayer.addChild(bg, shade, ...Object.values(titleTexts));
    fillTitle();
  }
  function fillTitle() {
    if (!titleTexts) return;
    const loc = i18n.locale;
    setText(titleTexts.title, kit.title[loc] ?? kit.title.th);
    setText(titleTexts.press, T("kit.title.press"));
    setText(titleTexts.lang, T("kit.title.lang", { lang: T(`lang.${loc}`) }));
    setText(titleTexts.keys, T("kit.title.keys"));
    setText(titleTexts.cont, saves.list().find((s) => s.slot === SLOT)?.exists ? T("kit.title.continue") : "");
  }

  let cs = null;
  async function startGame(intro = true) {
    titleLayer.removeChildren();
    titleTexts = null;
    if (intro && !state.flags.intro_seen) await playCutscene();
    else enterPlay();
  }
  async function playCutscene() {
    setMode("cutscene");
    state.events.push(`cutscene:${kit.cutscene}`);
    cs = await loadCutscene(PIXI, kit.cutsceneFile, { music, sfx: (id) => sfx(id), autoAdvance: true });
    cs.data.lang = i18n.locale === "th" ? "th" : "en";
    cs.view.scale.set(1.5);
    cutLayer.removeChildren();
    cutLayer.addChild(new PIXI.Graphics().rect(0, 0, W, H).fill(0x000000), cs.view, ftext(T("kit.skip"), { x: W - 6, y: 264, size: 8, align: "right" }));
    cs.on("finished", endCutscene);
    cs.play();
  }
  function endCutscene() {
    if (state.mode !== "cutscene") return;
    state.flags.intro_seen = true;
    cutLayer.removeChildren();
    cs = null;
    enterPlay();
  }
  function enterPlay() {
    setMode("play");
    music.play(kit.music.world, { fade: 1 }).catch(() => undefined);
    spawnFx("fireflies", 40 * 16, 3 * 16, { loop: true });
    markTarget();
    refreshTexts();
  }
  function setMode(m) {
    state.mode = m;
    clock.running = m === "play";
    ctl.speed = m === "play" ? SPEED : 0;
    if (m !== "play") map.keys.clear();
    refreshPrompt();
  }

  // ---------------------------------------------------------------- language
  async function setLanguage(loc) {
    es.setLocale(loc);
    document.documentElement.lang = loc;
    if (state.mode !== "dialogue") await loadBox();
    if (shop) {
      closeShop();
      openShop(kit.shop);
    }
    showToast(T("kit.toast.lang"));
    refreshTexts();
    tickNpcs();
  }
  const cycleLanguage = () => setLanguage(kit.locales[(kit.locales.indexOf(i18n.locale) + 1) % kit.locales.length]);

  // ---------------------------------------------------------------- save / load (Easy Save village_delivery schema)
  function spawnNear() {
    let best = "market";
    let bd = Infinity;
    for (const s of map.json.spawns) {
      const d = Math.hypot((s.x + 0.5) * 16 - player.sprite.x, (s.y + 1) * 16 - player.sprite.y);
      if (d < bd) (bd = d), (best = s.name);
    }
    return best;
  }
  function buildSave() {
    const qs = manager.state();
    const active = [];
    const done = [];
    const steps = {};
    const status = {};
    for (const [id, s] of Object.entries(qs.quests)) {
      status[id] = s.status;
      if (s.status === "active") active.push(id);
      else if (s.status === "completed") done.push(id);
      steps[id] = s.steps;
    }
    const vars = Object.fromEntries(Object.entries(qs.vars).filter(([, v]) => ["boolean", "number", "string"].includes(typeof v)));
    const face = { front: "down", back: "up", left: "left", right: "right" };
    return {
      player: { name: T(`dlg.${kit.dialogue.id}.char.kid`).slice(0, 16), money: inv.state.coins, scene: spawnNear(), pos: { x: player.sprite.x, y: player.sprite.y }, facing: face[player.facing] ?? "down", bike: "none" },
      day: npcRt ? clock.day + 1 : 1,
      time_of_day: timeOfDay(),
      quests: { active, done, steps, vars },
      items: { inventory: structuredClone(inv.state), quest_items: qs.items, seen: qs.seen, status, npc: npcRt ? { day: clock.day, minute: clock.minute, bonds: structuredClone(clock.bonds) } : {}, battle: eb ? structuredClone(battle) : {} },
      flags: { ...state.flags },
      deliveries: [["monk", "sticky_rice", "temple"], ["farmer", "morning_glory", "farm"], ["elder", "balm", "elder"]].map(([to, item, step]) => ({ to, item, done: manager.stepDone(q, step) })),
      settings: { locale: i18n.locale },
      stats: { playtime: Math.floor(state.playtime), max_money: state.maxMoney, saves: state.saves },
    };
  }
  const saveMeta = () => ({ label: `${spawnNear()} · ${questLines()[1]}`, playtime: Math.floor(state.playtime), locale: i18n.locale });
  function quickSave() {
    state.saves++;
    const r = saves.save(SLOT, buildSave(), saveMeta());
    state.events.push(`save:${r.ok}`);
    showToast(r.ok ? T("save.saved") : "save failed");
    return r;
  }
  async function quickLoad() {
    const r = saves.load(SLOT);
    if (!r.ok) {
      showToast(T("kit.toast.nosave"));
      return r;
    }
    await applySave(r.data);
    state.events.push("load:true");
    showToast(T("save.loaded"));
    return r;
  }
  async function applySave(d) {
    const it = d.items ?? {};
    const qd = d.quests ?? {};
    const status = it.status ?? {};
    const quests = {};
    for (const [id, st] of Object.entries(qd.steps ?? {})) quests[id] = { status: status[id] ?? (qd.active?.includes(id) ? "active" : qd.done?.includes(id) ? "completed" : "available"), steps: st };
    manager.load({ quests, vars: qd.vars ?? {}, items: it.quest_items ?? {}, seen: it.seen ?? {} });
    state.lastQuestCoins = Number(manager.vars.coins ?? 0);
    if (it.inventory) {
      inv.state = structuredClone(it.inventory);
      inv.emit?.();
    }
    state.flags = { ...(d.flags ?? {}) };
    if (npcRt && it.npc?.bonds) Object.assign(clock, { day: it.npc.day ?? 0, minute: it.npc.minute ?? clock.minute, bonds: structuredClone(it.npc.bonds) });
    if (eb && it.battle?.party) Object.assign(battle, structuredClone(it.battle));
    player.sprite.position.set(d.player?.pos?.x ?? player.sprite.x, d.player?.pos?.y ?? player.sprite.y);
    state.playtime = d.stats?.playtime ?? 0;
    const loc = d.settings?.locale;
    if (loc && loc !== i18n.locale) es.setLocale(loc);
    await loadBox();
    if (state.mode === "title") await startGame(false);
    else setMode("play");
    markTarget();
    refreshTexts();
  }
  es.startAutosave?.(buildSave, saveMeta);

  // ---------------------------------------------------------------- Easy NPC: villagers on their daily schedule
  const spec = kit.npcSchedule ?? {};
  const toMin = (s) => { const [h, m] = String(s ?? "07:00").split(":").map(Number); return h * 60 + (m || 0); };
  const clock = { day: 0, minute: toMin(spec.start), running: false, bonds: {}, spm: spec.secondsPerMinute ?? npcRt?.world.clock.secondsPerMinute ?? 1 };
  const scheduled = new Map();
  let nightShade = null;
  if (npcRt) {
    for (const [name, nid] of Object.entries(spec.map ?? {})) {
      const a = npcs.get(name);
      if (!a || !npcRt.world.npcs.some((x) => x.id === nid)) continue;
      a.c.patrol = null;
      scheduled.set(name, nid);
    }
    nightShade = new PIXI.Graphics().rect(0, 0, W, H).fill({ color: 0x1a2350, alpha: 0.38 });
    nightShade.visible = false;
    app.stage.addChildAt(nightShade, app.stage.getChildIndex(worldLayer) + 1);
  }
  const isNight = () => !!npcRt && npcRt.engine.isNight(npcRt.world.clock, clock.minute);
  function timeOfDay() {
    if (!npcRt) return "morning";
    if (isNight()) return "night";
    return clock.minute < 660 ? "morning" : clock.minute < 960 ? "noon" : "evening";
  }
  /** Place the scheduled villagers: Easy NPC tiles → map pixels (feet anchored like Easy Tilemap). */
  function tickNpcs() {
    if (!npcRt) return;
    for (const [name, nid] of scheduled) {
      const st = npcRt.engine.state(npcRt.world, nid, clock.day, clock.minute);
      const a = npcs.get(name);
      a.sprite.position.set(Math.round(st.x * 16 + 8), Math.round(st.y * 16 + 15));
      a.sprite.visible = !st.indoors;
      a.face(st.facing);
      a.walk(!!st.moving);
      a.sprite.zIndex = a.sprite.y;
    }
    const wd = npcRt.engine.weekday(npcRt.world.clock, clock.day);
    const label = `${(DAYS[i18n.locale] ?? DAYS.en)[wd] ?? wd} ${npcRt.engine.fmtTime(clock.minute)}`;
    if (getText(clockText) !== label) setText(clockText, label);
    nightShade.visible = isNight();
  }
  const setClock = (minute, day = clock.day) => { clock.minute = minute; clock.day = day; tickNpcs(); };

  // ---------------------------------------------------------------- Easy Battle: paddy-field encounters
  const bspec = kit.battle ?? null;
  const battle = { party: (bspec?.party ?? []).map((p) => ({ id: p.id, level: p.level ?? 1, xp: 0 })), steps: 0, first: false, won: 0 };
  let battleUi = null;
  let lastTile = "";
  const inBattleZone = (x, y) => {
    if (!eb || !bspec) return false;
    const [x0, y0, x1, y1] = bspec.zone;
    const tx = Math.floor(x / 16);
    const ty = Math.floor(y / 16);
    return tx >= x0 && ty >= y0 && tx < x1 && ty < y1;
  };
  function checkEncounter() {
    if (!inBattleZone(player.sprite.x, player.sprite.y)) return;
    const tile = `${Math.floor(player.sprite.x / 16)},${Math.floor(player.sprite.y / 16)}`;
    if (tile === lastTile) return;
    lastTile = tile;
    if (!battle.first) return startBattle(eb.scripted(bspec.table, bspec.firstSeed ?? 7));
    const rate = eb.db.encounters.find((t) => t.id === bspec.table)?.rate ?? 28;
    battle.steps++;
    if (battle.steps < 4 || Math.random() * rate >= 1) return;
    battle.steps = 0;
    startBattle(eb.scripted(bspec.table, Math.floor(Math.random() * 0x7fffffff)));
  }
  function startBattle(setup, opts = {}) {
    battle.first = true;
    state.events.push(`battle:${setup.table}`);
    setMode("battle");
    setText(prompt, "");
    battleUi = eb.start(app, { ...setup, party: battle.party.map((p) => ({ ...p })) }, {
      lang: i18n.locale,
      ...opts,
      onEnd: (result, rewards) => battleEnded(result, rewards),
      onClose: () => leaveBattle(),
    });
    return battleUi;
  }
  function battleEnded(result, rewards = {}) {
    state.events.push(`battle_end:${result}`);
    const c = result === "win" ? Number(rewards.coins ?? 0) : 0;
    if (c > 0) {
      inv.state.coins += c;
      inv.emit?.();
    }
    if (result === "win") {
      battle.won++;
      for (const p of battle.party) p.xp = (p.xp ?? 0) + Number(rewards.xp ?? 0);
      for (const l of rewards.levels ?? []) {
        const p = battle.party.find((x) => x.id === l.id);
        if (p) p.level = l.to;
      }
      showToast(T("kit.battle.win", { n: c }));
    } else showToast(T(result === "lose" ? "kit.battle.lose" : "kit.battle.fled"));
    refreshHud();
  }
  function leaveBattle() {
    battleUi = null;
    if (state.mode === "battle") setMode("play");
    music.play(kit.music.world, { fade: 0.6 }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- loop + input
  inv.onChange?.(() => refreshHud());
  app.ticker.add((tk) => {
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    map.update(dt);
    box?.update(dt);
    cs?.update(dt);
    talker?.update(dt);
    if (npcRt && clock.running) {
      clock.minute += dt / clock.spm;
      while (clock.minute >= 1440) (clock.minute -= 1440), clock.day++;
    }
    tickNpcs();
    if (state.mode === "play") {
      state.playtime += dt;
      checkEncounter();
      let best = "";
      let bd = TALK_RANGE;
      for (const [n, a] of npcs) {
        if (!kit.npcs[n] || !a.sprite.visible) continue;
        const d = Math.hypot(a.sprite.x - player.sprite.x, a.sprite.y - player.sprite.y);
        if (d < bd) (bd = d), (best = n);
      }
      if (best !== state.near) {
        state.near = best;
        refreshPrompt();
      }
    }
    if (toastLeft > 0 && (toastLeft -= dt) <= 0) setText(toast, "");
  });

  addEventListener("keydown", async (e) => {
    const k = e.key.toLowerCase();
    if (state.mode === "battle") return; // Easy Battle has its own keys
    if (["f5", "f9", " ", "arrowup", "arrowdown"].includes(k)) e.preventDefault();
    if (state.mode === "title") {
      if (k === "enter" || k === " " || k === "e") await startGame();
      else if (k === "l") await cycleLanguage();
      else if (k === "f9") await quickLoad();
    } else if (state.mode === "cutscene") {
      if (k === "escape") endCutscene();
      else if (k === "enter" || k === " ") cs?.advance();
    } else if (state.mode === "dialogue") {
      if (box.state === "choices") {
        if (k === "arrowup" || k === "w") box.select(box.selected - 1, -1);
        else if (k === "arrowdown" || k === "s") box.select(box.selected + 1, 1);
        else if (k === "enter" || k === " " || k === "e") box.choose();
        else if (/^[1-9]$/.test(k)) box.choose(Number(k) - 1);
      } else if (k === "enter" || k === " " || k === "e") box.advance();
    } else if (state.mode === "play") {
      if (k === "e" || k === "enter" || k === " ") interact();
      else if (k === "l") await cycleLanguage();
      else if (k === "f5") quickSave();
      else if (k === "f9") await quickLoad();
    } else if (state.mode === "shop" && k === "escape") closeShop();
  });
  app.canvas.addEventListener("pointerdown", () => {
    if (state.mode === "dialogue" && box.state !== "choices") box.advance();
  });

  await loadBox();
  refreshTexts();
  showTitle();

  // ---------------------------------------------------------------- hooks for automated checks
  const driveDialogue = () => {
    let guard = 0;
    while (state.mode === "dialogue" && guard++ < 400) {
      if (box.state === "choices") box.choose(0);
      else {
        box.advance();
        box.update(0);
      }
    }
    return guard;
  };
  window.__kit = {
    kit, app, map, manager, inv, i18n, saves, state, fx, music, bank,
    get box() { return box; },
    get mode() { return state.mode; },
    startGame, endCutscene, interact, setLanguage, quickSave, quickLoad, openShop, closeShop, questTarget, driveDialogue, buildSave,
    near(npc, dx = 0, dy = 14) {
      const n = npcs.get(npc);
      player.sprite.position.set(n.sprite.x + dx, n.sprite.y + dy);
      state.near = npc;
      map.update(0);
    },
    hud: () => ({ coins: getText(coinText), questTitle: getText(questTitle), questText: getText(questText), prompt: getText(prompt), toast: getText(toast), clock: getText(clockText) }),
    features: feat, ef, plib, npcRt, eb, clock, scheduled, setClock, timeOfDay, battle, startBattle, inBattleZone,
    get battleUi() { return battleUi; },
    get talker() { return talker; },
    pixelFont: () => ({ hud: questTitle.__pixel ?? null, dialogue: box?.body?.constructor?.name ?? null }),
    npcPos: (name) => { const a = npcs.get(name); return { x: a.sprite.x, y: a.sprite.y, visible: a.sprite.visible }; },
    hasThai: (s) => THAI.test(s),
  };
  window.__ready = true;
}
