// Easy Kit glue for the village_delivery template — PixiJS v8 build. MIT © Salahuddin Benno.
// Every asset and runtime comes from an Easy tool export in its own folder:
//   tilemap/ (Easy Tilemap + Easy Sprite cast) · dialogue/ · quest/ · ui/ · sfx/ · fx/ · music/ · anim/ · items/ · save/
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

  // ---------------------------------------------------------------- HUD
  const coinPanel = ui.panel({ x: W - 96, y: 6, w: 90, h: 22 });
  const coinIcon = ui.icon("coin");
  coinIcon.position.set(W - 92, 9);
  const coinText = ui.text("", { x: W - 12, y: 21, size: 10, align: "right" });
  const questPanel = ui.panel({ x: W - 186, y: 32, w: 180, h: 34 });
  const questTitle = ui.text("", { x: W - 178, y: 45, size: 9, title: true });
  const questText = ui.text("", { x: W - 178, y: 59, size: 8 });
  const prompt = ui.text("", { x: W / 2, y: 214, size: 10, align: "center" });
  const toast = ui.text("", { x: W / 2, y: 124, size: 11, align: "center" });
  hudLayer.addChild(coinPanel, coinIcon, coinText, questPanel, questTitle, questText, prompt, toast);
  let toastLeft = 0;
  const setText = (t, s) => (t.setText ? t.setText(s) : (t.text = s));
  const getText = (t) => (t.children?.length ? t.children[t.children.length - 1].text : t.text) ?? "";
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
      onLine: (ev) => sfx({ kid: "blip_kid", vendor: "blip_auntie", monk: "blip_monk", elder: "blip_elder" }[ev.speaker] ?? "blip_mid", 0.4),
      onEnd: (vars) => finishSegment(vars),
    });
    box.view.visible = false;
    dialogueLayer.addChild(box.view);
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
    const n = npcs.get(npc);
    const lines = ui.wrap(text, 150, 8);
    const h = 10 + lines.length * 11;
    const bubble = ui.panel({ x: 0, y: 0, w: 160, h, small: true });
    lines.forEach((l, i) => bubble.addChild(ui.text(l, { x: 6, y: 13 + i * 11, size: 8 })));
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
      press: ui.text("", { x: W / 2, y: 204, size: 12, align: "center" }),
      lang: ui.text("", { x: W / 2, y: 222, size: 10, align: "center" }),
      keys: ui.text("", { x: W / 2, y: 244, size: 9, align: "center" }),
      cont: ui.text("", { x: W / 2, y: 260, size: 9, align: "center" }),
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
    cutLayer.addChild(new PIXI.Graphics().rect(0, 0, W, H).fill(0x000000), cs.view, ui.text(T("kit.skip"), { x: W - 6, y: 264, size: 8, align: "right" }));
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
      day: 1,
      time_of_day: "morning",
      quests: { active, done, steps, vars },
      items: { inventory: structuredClone(inv.state), quest_items: qs.items, seen: qs.seen, status },
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

  // ---------------------------------------------------------------- loop + input
  inv.onChange?.(() => refreshHud());
  app.ticker.add((tk) => {
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    map.update(dt);
    box?.update(dt);
    cs?.update(dt);
    if (state.mode === "play") {
      state.playtime += dt;
      let best = "";
      let bd = TALK_RANGE;
      for (const [n, a] of npcs) {
        if (!kit.npcs[n]) continue;
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
    hud: () => ({ coins: getText(coinText), questTitle: getText(questTitle), questText: getText(questText), prompt: getText(prompt), toast: getText(toast) }),
    hasThai: (s) => THAI.test(s),
  };
  window.__ready = true;
}
