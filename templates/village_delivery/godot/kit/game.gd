extends Node2D
## Easy Kit glue for the village_delivery template (MIT © Salahuddin Benno).
## Everything on screen comes from the Easy tools; this script only wires them together:
##   Easy Tilemap world + Easy Sprite cast · Easy Dialogue box · Easy Quest manager · Easy Items shop
##   Easy Anim intro cutscene · Easy Music / Easy SFX / Easy FX · Easy Save slots + I18n (th / en / ms)
##   Easy UI HUD + theme · Easy Scene title backdrop.
## Optional (when kit.json lists them): Easy Portrait animated dialogue portraits · Easy NPC daily schedules + clock ·
##   Easy Font มะขาม pixel text · Easy Battle paddy-field encounters.
## Keys: arrows / WASD walk · E / Enter talk · L language · F5 save · F9 load · Esc skip / close.

signal mode_changed(mode: String)

const KIT_JSON := "res://kit/kit.json"
const SPEED := 72.0
const TALK_RANGE := 28.0
const SAVE_SLOT := "quick"

var kit: Dictionary = {}
var mode := "boot"
var world: Node2D
var world_layer: Node2D
var camera: Camera2D
var player: CharacterBody2D
var player_sprite: AnimatedSprite2D
var facing := "front"
var npcs: Dictionary = {}           # map name -> AnimatedSprite2D
var near := ""
var segment := ""
var flags: Dictionary = {}          # ending_seen, intro_seen …
var last_quest_coins := 0
var playtime := 0.0
var _step_timer := 0.0
var _saves := 0
var _max_money := 0

var theme_res: Theme
var ui: CanvasLayer
var hud: Control
var prompt: Label
var toast: Label
var _toast_left := 0.0
var box: Control
var shop: Control
var title_layer: CanvasLayer
var cutscene_layer: CanvasLayer
var cutscene: Node
var events: Array = []              # log for tests: ["dialogue:market", "shop:open", …]

# optional tools (Easy Portrait / NPC / Font / Battle)
var feat: Dictionary = {}
var clock_label: Label
var night_tint: CanvasModulate
var scheduled: Dictionary = {}      # kit map name -> Easy NPC id
var talker: Control                 # EasyPortrait over the dialogue box portrait
var battle_layer: CanvasLayer
var battle_scene: Node
var battles := 0
var _last_tile := Vector2i(-999, -999)
# optional autoloads, looked up at runtime so the game still parses without them
var NPCS: Node
var BATTLE: Node
var EFONT: Node
var PORTRAITS: Node


func _ready() -> void:
	kit = JSON.parse_string(FileAccess.get_file_as_string(KIT_JSON))
	theme_res = load(kit["theme"]) if ResourceLoader.exists(kit["theme"]) else null
	I18n.set_locale(str(kit.get("defaultLocale", "th")))
	feat = kit.get("features", {})
	NPCS = get_node_or_null("/root/NPCs")
	BATTLE = get_node_or_null("/root/Battle")
	EFONT = get_node_or_null("/root/EasyFont")
	PORTRAITS = get_node_or_null("/root/Portraits")
	_setup_world()
	_setup_ui()
	_setup_npcs()
	_setup_battle()
	_setup_quest()
	Items.reset()
	Items.coins_changed.connect(func(_c): _refresh_hud())
	_load_dialogue()
	SaveManager.start_autosave(Callable(self, "build_save"), Callable(self, "save_meta"))
	_refresh_texts()
	show_title()


# ------------------------------------------------------------------ world + cast

func _setup_world() -> void:
	world = (load(kit["world"]) as PackedScene).instantiate()
	add_child(world)
	world_layer = world.get_node("World")
	camera = world.get_node("Camera2D")
	camera.set_script(null)
	camera.make_current()
	for c in world_layer.get_children():
		if c is AnimatedSprite2D and String(c.name).begins_with("C"):
			var parts := String(c.name).split("_", true, 1)
			if parts.size() == 2:
				npcs[parts[1]] = c
	var ton: AnimatedSprite2D = npcs.get(kit["player"])
	npcs.erase(kit["player"])
	player = CharacterBody2D.new()
	player.name = "Player"
	player.position = ton.position
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(10, 6)
	shape.shape = rect
	shape.position = Vector2(0, -3)
	player.add_child(shape)
	world_layer.add_child(player)
	ton.get_parent().remove_child(ton)
	ton.position = Vector2.ZERO
	ton.set_script(null)
	player.add_child(ton)
	player_sprite = ton
	# Standing NPCs block the path; patrolling ones stay walk-through.
	for n in npcs:
		var s: AnimatedSprite2D = npcs[n]
		if s.get_script() == null:
			var body := StaticBody2D.new()
			var cs := CollisionShape2D.new()
			var r := RectangleShape2D.new()
			r.size = Vector2(12, 6)
			cs.shape = r
			cs.position = Vector2(0, -3)
			body.add_child(cs)
			s.add_child(body)
	camera.position = player.position


func npc_name(id: String) -> String:
	return I18n.t("kit.npc.%s.name" % id)


# ------------------------------------------------------------------ Easy Font (มะขาม pixel text)

func has_font() -> bool:
	return bool(feat.get("font", false)) and EFONT != null


## Pixel font for HUD-sized labels (big titles keep Kanit).
func use_font(l: Control, size := 10) -> void:
	if not has_font() or size > 12:
		return
	var id: String = str(kit["font"]["small"] if size <= 8 else kit["font"]["hud"])
	var f = EFONT.font(id)
	if f == null:
		return
	l.add_theme_font_override("font", f)
	l.add_theme_font_size_override("font_size", EFONT.size_of(id))
	l.set_meta("easyfont", true)


## Set label text (shaped for the pixel font when the label uses it).
func set_text(l: Label, text: String) -> void:
	l.text = EFONT.shape(text) if l.has_meta("easyfont") else text


func _nearest_npc() -> String:
	var best := ""
	var best_d := TALK_RANGE
	for n in npcs:
		if not kit["npcs"].has(n) or not (npcs[n] as Node2D).visible:
			continue
		var d: float = (npcs[n] as Node2D).position.distance_to(player.position)
		if d < best_d:
			best_d = d
			best = n
	return best


func _physics_process(delta: float) -> void:
	if mode != "play":
		return
	playtime += delta
	var dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if dir == Vector2.ZERO:
		dir = Vector2(float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A)), float(Input.is_key_pressed(KEY_S)) - float(Input.is_key_pressed(KEY_W)))
	walk(dir, delta)


## Move the player one physics step (also used by the headless test).
func walk(dir: Vector2, delta: float) -> void:
	if dir.length() > 1.0:
		dir = dir.normalized()
	player.velocity = dir * SPEED
	player.move_and_slide()
	if dir != Vector2.ZERO:
		facing = ("left" if dir.x < 0.0 else "right") if absf(dir.x) >= absf(dir.y) else ("back" if dir.y < 0.0 else "front")
		_step_timer -= delta
		if _step_timer <= 0.0:
			_step_timer = 0.34
			SfxBank.play("footstep", -14.0, randf_range(0.9, 1.1))
			EasyFx.spawn(world_layer, "footstep_dust", player.position + Vector2(0, -2))
	var anim := ("walk_" if dir != Vector2.ZERO else "idle_") + facing
	if player_sprite.animation != anim and player_sprite.sprite_frames.has_animation(anim):
		player_sprite.play(anim)
	camera.position = player.position
	var n := _nearest_npc()
	if n != near:
		near = n
		_refresh_prompt()
	if dir != Vector2.ZERO:
		_check_encounter()


# ------------------------------------------------------------------ UI

func _label(size: int) -> Label:
	var l := Label.new()
	if theme_res:
		l.theme = theme_res
	l.add_theme_font_size_override("font_size", size)
	use_font(l, size)
	l.add_theme_color_override("font_outline_color", Color("#1a120c"))
	l.add_theme_constant_override("outline_size", 3)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _setup_ui() -> void:
	ui = CanvasLayer.new()
	ui.layer = 4
	add_child(ui)
	hud = (load(kit["hudScene"]) as PackedScene).instantiate()
	hud.set_script(null)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for n in ["Backdrop", "Background", "Status", "Portrait", "HpLabel", "Hp", "MpLabel", "Mp", "XpLabel", "Xp", "Hotbar"]:
		var c := hud.get_node_or_null(n)
		if c:
			c.visible = false
	ui.add_child(hud)
	for path in ["CoinText", "Quest/Title", "Quest/Text"]:
		var hl := hud.get_node_or_null(path) as Label
		if hl:
			use_font(hl, 8)
	if has_font() and hud.get_node_or_null("Quest/Text"):
		# the pixel font's Thai line is taller than Kanit 9: give the quest panel one more step of room
		var qp := hud.get_node("Quest") as Control
		qp.offset_bottom = qp.offset_top + 36.0
		(hud.get_node("Quest/Title") as Control).position.y = 1.0
		(hud.get_node("Quest/Text") as Control).position.y = 17.0
	clock_label = _label(10)
	clock_label.position = Vector2(8, 6)
	clock_label.size = Vector2(160, 16)
	clock_label.visible = bool(feat.get("npc", false))
	ui.add_child(clock_label)
	prompt = _label(10)
	prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt.position = Vector2(0, 200)
	prompt.size = Vector2(kit_width(), 16)
	ui.add_child(prompt)
	toast = _label(11)
	toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast.position = Vector2(0, 112)
	toast.size = Vector2(kit_width(), 16)
	toast.add_theme_color_override("font_color", Color("#ffd27a"))
	ui.add_child(toast)
	box = (load(kit["dialogueBox"]) as PackedScene).instantiate()
	box.set("autostart", false)
	box.set("dialogue_path", "")
	ui.add_child(box)
	box.visible = false
	box.connect("dialogue_finished", _on_dialogue_finished)
	box.connect("event_fired", _on_dialogue_event)
	box.connect("line_started", _on_line)


func kit_width() -> float:
	return float(ProjectSettings.get_setting("display/window/size/viewport_width", 480))


func show_toast(text: String, secs := 2.2) -> void:
	set_text(toast, text)
	_toast_left = secs


func _process(delta: float) -> void:
	if _toast_left > 0.0:
		_toast_left -= delta
		if _toast_left <= 0.0:
			toast.text = ""
	_tick_npcs()


func _refresh_prompt() -> void:
	if mode != "play" or near == "":
		prompt.text = ""
		return
	var role: String = kit["npcs"][near].get("role", "bark")
	set_text(prompt, I18n.t("kit.prompt.shop" if role == "shop" else "kit.prompt.talk", {"name": npc_name(near)}))


func quest_lines() -> PackedStringArray:
	var q: String = kit["quest"]["main"]
	var st := QuestManager.status(q)
	if st == "active":
		var cur := QuestManager.current_step(q)
		var step := I18n.t("quest.%s.step.%s" % [q, cur.get("id", "report")])
		return PackedStringArray([I18n.t("quest.%s.title" % q), QuestManager.interpolate(step)])
	if st == "completed":
		return PackedStringArray([I18n.t("quest.%s.title" % q), I18n.t("kit.quest.done")])
	return PackedStringArray([I18n.t("kit.quest.label"), I18n.t("kit.quest.none")])


func _refresh_hud() -> void:
	var coin := hud.get_node_or_null("CoinText") as Label
	if coin:
		set_text(coin, I18n.t("kit.coins", {"n": Items.state.get("coins", 0)}))
	_max_money = maxi(_max_money, int(Items.state.get("coins", 0)))
	var lines := quest_lines()
	var title := hud.get_node_or_null("Quest/Title") as Label
	var text := hud.get_node_or_null("Quest/Text") as Label
	if title:
		set_text(title, lines[0])
	if text:
		set_text(text, lines[1])


func _refresh_texts() -> void:
	_refresh_hud()
	_refresh_prompt()
	if title_layer:
		_fill_title()


# ------------------------------------------------------------------ title + cutscene

func show_title() -> void:
	_set_mode("title")
	title_layer = CanvasLayer.new()
	title_layer.layer = 8
	add_child(title_layer)
	var bg := TextureRect.new()
	bg.texture = load(kit["titleImage"])
	bg.size = Vector2(kit_width(), 270)
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	title_layer.add_child(bg)
	var shade := ColorRect.new()
	shade.color = Color(0.05, 0.03, 0.02, 0.45)
	shade.position = Vector2(0, 150)
	shade.size = Vector2(kit_width(), 120)
	title_layer.add_child(shade)
	for id in ["Title", "Press", "Keys", "Lang", "Continue"]:
		var l := _label({"Title": 24, "Press": 12, "Keys": 9, "Lang": 10, "Continue": 9}[id])
		l.name = id
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.size = Vector2(kit_width(), 20)
		l.position = Vector2(0, {"Title": 156, "Press": 192, "Keys": 236, "Lang": 212, "Continue": 250}[id])
		title_layer.add_child(l)
	_fill_title()


func _fill_title() -> void:
	if not is_instance_valid(title_layer):
		return
	var loc := I18n.get_locale()
	(title_layer.get_node("Title") as Label).text = str(kit["title"].get(loc, kit["title"]["th"]))
	set_text(title_layer.get_node("Press") as Label, I18n.t("kit.title.press"))
	set_text(title_layer.get_node("Keys") as Label, I18n.t("kit.title.keys"))
	set_text(title_layer.get_node("Lang") as Label, I18n.t("kit.title.lang", {"lang": I18n.t("lang." + loc)}))
	set_text(title_layer.get_node("Continue") as Label, I18n.t("kit.title.continue") if FileAccess.file_exists(SaveManager.path_of(SAVE_SLOT)) else "")


func start_game(play_intro := true) -> void:
	if is_instance_valid(title_layer):
		title_layer.queue_free()
	title_layer = null
	if play_intro and not flags.get("intro_seen", false):
		play_cutscene()
	else:
		_enter_play()


func play_cutscene() -> void:
	_set_mode("cutscene")
	events.append("cutscene:" + str(kit["cutscene"]))
	cutscene_layer = CanvasLayer.new()
	cutscene_layer.layer = 10
	add_child(cutscene_layer)
	var black := ColorRect.new()
	black.color = Color.BLACK
	black.size = Vector2(kit_width(), 270)
	cutscene_layer.add_child(black)
	var holder := SubViewportContainer.new()
	holder.stretch = false
	holder.size = Vector2(320, 180)
	holder.scale = Vector2(1.5, 1.5)
	holder.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	cutscene_layer.add_child(holder)
	var vp := SubViewport.new()
	vp.size = Vector2i(320, 180)
	vp.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	holder.add_child(vp)
	cutscene = (load(kit["cutsceneScene"]) as PackedScene).instantiate()
	cutscene.set("auto_advance", true)
	vp.add_child(cutscene)
	var loc := I18n.get_locale()
	cutscene.data["lang"] = "th" if loc == "th" else "en"
	var skip := _label(8)
	set_text(skip, I18n.t("kit.skip"))
	skip.position = Vector2(kit_width() - 110, 256)
	skip.size = Vector2(104, 12)
	skip.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	cutscene_layer.add_child(skip)
	cutscene.connect("finished", end_cutscene)


func end_cutscene() -> void:
	if mode != "cutscene":
		return
	flags["intro_seen"] = true
	if is_instance_valid(cutscene_layer):
		cutscene_layer.queue_free()
	cutscene_layer = null
	cutscene = null
	_enter_play()


func _enter_play() -> void:
	_set_mode("play")
	MusicPlayer.play(kit["music"]["world"], 1.0)
	EasyFx.spawn(world_layer, "fireflies", Vector2(40 * 16, 3 * 16), false)
	_mark_quest_target()
	_refresh_texts()


func _set_mode(m: String) -> void:
	mode = m
	mode_changed.emit(m)
	if feat.get("npc", false):
		NPCS.running = m == "play"
	if talker and m != "dialogue":
		talker.visible = false
	if prompt:
		_refresh_prompt()


var _marker: Node2D

## Sparkle over the NPC the current quest step points at.
func _mark_quest_target() -> void:
	if is_instance_valid(_marker):
		_marker.queue_free()
	var target := quest_target()
	if target == "" or not npcs.has(target):
		return
	_marker = EasyFx.spawn(world_layer, "sparkle_shine", (npcs[target] as Node2D).position + Vector2(0, -52))
	if _marker:
		_marker.z_index = 50


func quest_target() -> String:
	var q: String = kit["quest"]["main"]
	var st := QuestManager.status(q)
	if st == "completed":
		return "" if flags.get("ending_seen", false) else _npc_for("vendor")
	if st != "active":
		return _npc_for("vendor")
	match str(QuestManager.current_step(q).get("id", "")):
		"accept":
			return _npc_for("vendor")
		"temple":
			return _npc_for("monk")
		"farm":
			return _npc_for("farmer")
		"elder":
			return _npc_for("elder")
	return ""


func _npc_for(speaker: String) -> String:
	for n in kit["npcs"]:
		if str(kit["npcs"][n].get("speaker", "")) == speaker:
			return n
	return ""


# ------------------------------------------------------------------ quest + dialogue

func _setup_quest() -> void:
	QuestManager.load_file(kit["questFile"])
	last_quest_coins = int(QuestManager.vars.get("coins", 0))
	QuestManager.flag_changed.connect(_on_flag)
	QuestManager.item_changed.connect(_on_quest_item)
	QuestManager.step_completed.connect(_on_step)
	QuestManager.quest_completed.connect(_on_quest_done)
	QuestManager.quest_event.connect(func(n: String, a: Array): if n == "sfx" and a.size() > 0: _sfx(str(a[0])))
	QuestManager.changed.connect(_refresh_hud)


func _load_dialogue() -> void:
	var loc := I18n.get_locale()
	var files: Dictionary = kit["dialogueFiles"]
	box.call("load_dialogue", files.get(loc, files["th"]), QuestManager.vars.duplicate())
	QuestManager.connect_dialogue(box.get("runner"), kit["dialogue"]["id"])


func segment_for(speaker: String) -> String:
	var q: String = kit["quest"]["main"]
	var st := QuestManager.status(q)
	var step := str(QuestManager.current_step(q).get("id", ""))
	match speaker:
		"vendor":
			if st == "available" or st == "locked" or (st == "active" and step == "accept"):
				return "market"
			if st == "completed" and not flags.get("ending_seen", false):
				return "ending"
		"monk":
			if st == "active" and step == "temple":
				return "temple"
		"farmer":
			if st == "active" and step == "farm":
				return "farm"
		"elder":
			if st == "active" and step == "elder":
				return "elder"
	return ""


## E / Enter next to an NPC (also called by the headless test).
func interact(npc := "") -> String:
	if npc == "":
		npc = near
	if npc == "" or not kit["npcs"].has(npc):
		return ""
	var info: Dictionary = kit["npcs"][npc]
	var role := str(info.get("role", "bark"))
	if info.has("speaker"):
		QuestManager.emit_event("talk", [info["speaker"]])
	if role == "shop":
		open_shop(str(info.get("shop", kit["shop"])))
		return "shop"
	if role == "quest":
		var seg := segment_for(str(info["speaker"]))
		if seg != "":
			start_segment(seg)
			return "dialogue:" + seg
	bark(npc)
	return "bark"


func start_segment(seg: String) -> void:
	segment = seg
	events.append("dialogue:" + seg)
	var runner = box.get("runner")
	for k in QuestManager.vars:
		runner.vars[k] = QuestManager.vars[k]
	_set_mode("dialogue")
	box.call("start", seg)


func _on_line(ev: Dictionary) -> void:
	call_deferred("_talk_portrait", ev)
	var voice := str({"kid": "blip_kid", "vendor": "blip_auntie", "monk": "blip_monk", "elder": "blip_elder"}.get(str(ev.get("speaker", "")), "blip_mid"))
	_sfx(voice, -10.0)


func _on_dialogue_event(n: String, args: Array) -> void:
	if n == "sfx" and args.size() > 0:
		_sfx(str(args[0]))


func _on_dialogue_finished(vars: Dictionary) -> void:
	# Segment over: push the runner's variables (delivered, coins, mango) into the quest manager.
	QuestManager.emit_event("segment", [segment], vars)
	if segment == "ending":
		flags["ending_seen"] = true
	segment = ""
	_set_mode("play")
	_mark_quest_target()
	_refresh_texts()


func bark(npc: String) -> void:
	events.append("bark:" + npc)
	var text := I18n.t("kit.npc.%s.bark" % npc)
	if scheduled.has(npc):
		var nid: String = scheduled[npc]
		NPCS.talk(nid)
		var st = NPCS.state(nid)
		if st != null:
			text += "\n(" + NPCS.activity_name(str(st["activity"])) + ")"
	var speaker := str(kit["npcs"][npc].get("speaker", ""))
	if speaker == "vendor" and QuestManager.status(kit["quest"]["main"]) == "active":
		var q: String = kit["quest"]["main"]
		var step := str(QuestManager.current_step(q).get("id", ""))
		var hint_key := "quest.%s.step.%s.hint" % [q, step]
		text = I18n.t(hint_key) if I18n.t(hint_key) != hint_key else I18n.t("quest.%s.step.%s" % [q, step])
	var panel := PanelContainer.new()
	if theme_res:
		panel.theme = theme_res
	var l := _label(8)
	if l.has_meta("easyfont"):
		l.text = EFONT.wrap(text, str(kit["font"]["small"]), 150)
	else:
		l.text = text
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(150, 0)
	panel.add_child(l)
	panel.z_index = 100
	panel.position = (npcs[npc] as Node2D).position + Vector2(-80, -84)
	world_layer.add_child(panel)
	_sfx("blip_mid", -8.0)
	get_tree().create_timer(2.8).timeout.connect(panel.queue_free)


func _on_flag(n: String, v) -> void:
	if n != "coins":
		return
	var delta := int(v) - last_quest_coins
	last_quest_coins = int(v)
	if delta > 0:
		Items.state["coins"] = int(Items.state.get("coins", 0)) + delta
		Items.coins_changed.emit(int(Items.state["coins"]))
		_sfx("coin")
		EasyFx.spawn(world_layer, "coin_burst", player.position + Vector2(0, -28))


func _on_quest_item(id: String, count: int) -> void:
	if not Items.items.has(id):
		return
	var diff := count - Items.count(id)
	if diff > 0:
		Items.add(id, diff)
	elif diff < 0:
		Items.remove(id, -diff)


func _on_step(q: String, step: String) -> void:
	events.append("step:%s.%s" % [q, step])
	show_toast(I18n.t("kit.quest.step", {"step": I18n.t("quest.%s.step.%s" % [q, step])}))
	_sfx("confirm")
	EasyFx.spawn(world_layer, "heal_plus", player.position + Vector2(0, -24))


func _on_quest_done(q: String) -> void:
	events.append("complete:" + q)
	if q != kit["quest"]["main"]:
		return
	show_toast(I18n.t("kit.quest.done"), 3.0)
	_sfx("powerup")
	EasyFx.spawn(world_layer, "level_up", player.position + Vector2(0, -24))
	EasyFx.spawn(world_layer, "confetti", player.position + Vector2(0, -40))


func _sfx(id: String, db := 0.0) -> void:
	if SfxBank.has_sound(id):
		SfxBank.play(id, db)


# ------------------------------------------------------------------ shop

func open_shop(id: String) -> void:
	events.append("shop:" + id)
	shop = (load(kit["shopScene"]) as PackedScene).instantiate()
	shop.set("lang", I18n.get_locale())
	ui.add_child(shop)
	shop.call("open", id)
	# Easy Items lays the shop out for 640×360; fit it into the game viewport.
	# It anchors itself full-rect in _ready, so pin it to a 640×360 box and scale that box down.
	var k := minf(1.0, kit_width() / 640.0)
	shop.set_anchors_preset(Control.PRESET_TOP_LEFT)
	shop.position = Vector2.ZERO
	shop.size = Vector2(640, 360)
	shop.scale = Vector2(k, k)
	shop.connect("closed", close_shop)
	shop.connect("traded", _on_trade)
	_set_mode("shop")
	MusicPlayer.play(kit["music"]["shop"], 0.6)


func _on_trade(kind: String, item: String, result: Dictionary) -> void:
	if not result.get("ok", false):
		_sfx("hurt", -6.0)
		return
	events.append("%s:%s" % [kind, item])
	_sfx("coin")
	show_toast(I18n.t("kit.toast.bought", {"item": Items.item_name(item, I18n.get_locale())}))
	_refresh_hud()


func close_shop() -> void:
	if is_instance_valid(shop):
		shop.queue_free()
	shop = null
	_set_mode("play")
	MusicPlayer.play(kit["music"]["world"], 0.6)
	_refresh_hud()


# ------------------------------------------------------------------ language

func set_language(loc: String) -> void:
	I18n.set_locale(loc)
	if feat.get("npc", false):
		NPCS.lang = loc
	if feat.get("battle", false):
		BATTLE.lang = loc
	if mode != "dialogue":
		_load_dialogue()
	if is_instance_valid(shop):
		shop.set("lang", loc)
		shop.call("open", str(kit["shop"]))
	show_toast(I18n.t("kit.toast.lang"))
	_refresh_texts()


func cycle_language() -> void:
	var locs: Array = kit["locales"]
	var i := locs.find(I18n.get_locale())
	set_language(str(locs[(i + 1) % locs.size()]))


# ------------------------------------------------------------------ save / load (Easy Save village_delivery schema)

func _spawn_near() -> String:
	var best := "market"
	var best_d := INF
	for m in world.get_node("Spawns").get_children():
		var d: float = (m as Node2D).position.distance_to(player.position)
		if d < best_d:
			best_d = d
			best = String(m.name)
	return best


func build_save() -> Dictionary:
	var qs := QuestManager.get_state()
	var active: Array = []
	var done: Array = []
	var steps := {}
	var status := {}
	for id in qs["quests"]:
		var s: Dictionary = qs["quests"][id]
		status[id] = s["status"]
		if s["status"] == "active":
			active.append(id)
		elif s["status"] == "completed":
			done.append(id)
		steps[id] = s["steps"]
	var vars := {}
	for k in qs["vars"]:
		var v = qs["vars"][k]
		if typeof(v) in [TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING]:
			vars[k] = v
	var q: String = kit["quest"]["main"]
	var deliveries: Array = []
	for d in [["monk", "sticky_rice", "temple"], ["farmer", "morning_glory", "farm"], ["elder", "balm", "elder"]]:
		deliveries.append({"to": d[0], "item": d[1], "done": QuestManager.step_done(q, d[2])})
	var face := {"front": "down", "back": "up", "left": "left", "right": "right"}
	return {
		"player": {"name": I18n.t("dlg.%s.char.kid" % kit["dialogue"]["id"]).left(16), "money": int(Items.state.get("coins", 0)), "scene": _spawn_near(), "pos": {"x": player.position.x, "y": player.position.y}, "facing": face.get(facing, "down"), "bike": "none"},
		"day": (int(NPCS.day) + 1) if feat.get("npc", false) else 1,
		"time_of_day": time_of_day(),
		"quests": {"active": active, "done": done, "steps": steps, "vars": vars},
		"items": {"inventory": Items.to_dict(), "quest_items": qs["items"], "seen": qs["seen"], "status": status, "npc": NPCS.to_dict() if feat.get("npc", false) else {}, "battle": BATTLE.to_dict() if feat.get("battle", false) else {}},
		"flags": flags.duplicate(),
		"deliveries": deliveries,
		"settings": {"locale": I18n.get_locale()},
		"stats": {"playtime": int(playtime), "max_money": _max_money, "saves": _saves},
	}


func save_meta() -> Dictionary:
	return {"label": "%s · %s" % [_spawn_near(), quest_lines()[1]], "locale": I18n.get_locale()}


func quick_save() -> Dictionary:
	_saves += 1
	var r: Dictionary = SaveManager.save_slot(SAVE_SLOT, build_save(), save_meta())
	events.append("save:" + str(r.get("ok", false)))
	show_toast(I18n.t("save.saved") if r.get("ok", false) else "save failed")
	return r


func quick_load() -> Dictionary:
	if not FileAccess.file_exists(SaveManager.path_of(SAVE_SLOT)):
		show_toast(I18n.t("kit.toast.nosave"))
		return {"ok": false, "reason": "missing"}
	var r: Dictionary = SaveManager.load_slot(SAVE_SLOT)
	if not r.get("ok", false):
		show_toast(str(r.get("reason", "load failed")))
		return r
	apply_save(r["data"])
	events.append("load:true")
	show_toast(I18n.t("save.loaded"))
	return r


func apply_save(d: Dictionary) -> void:
	var it: Dictionary = d.get("items", {})
	var status: Dictionary = it.get("status", {})
	var quests := {}
	var qd: Dictionary = d.get("quests", {})
	for id in qd.get("steps", {}):
		quests[id] = {"status": status.get(id, "active" if id in qd.get("active", []) else ("completed" if id in qd.get("done", []) else "available")), "steps": qd["steps"][id]}
	for id in status:
		if not quests.has(id):
			quests[id] = {"status": status[id], "steps": []}
	QuestManager.load_state({"quests": quests, "vars": qd.get("vars", {}), "items": it.get("quest_items", {}), "seen": it.get("seen", {})})
	last_quest_coins = int(QuestManager.vars.get("coins", 0))
	if it.has("inventory"):
		Items.from_dict(it["inventory"])
	if feat.get("npc", false) and typeof(it.get("npc")) == TYPE_DICTIONARY and not it["npc"].is_empty():
		NPCS.from_dict(it["npc"])
	if feat.get("battle", false) and typeof(it.get("battle")) == TYPE_DICTIONARY and not it["battle"].is_empty():
		BATTLE.from_dict(it["battle"])
	flags = d.get("flags", {}).duplicate()
	var p: Dictionary = d.get("player", {})
	var pos: Dictionary = p.get("pos", {})
	player.position = Vector2(float(pos.get("x", player.position.x)), float(pos.get("y", player.position.y)))
	camera.position = player.position
	playtime = float(d.get("stats", {}).get("playtime", 0))
	var loc := str(d.get("settings", {}).get("locale", I18n.get_locale()))
	if loc != I18n.get_locale():
		I18n.set_locale(loc)
	_load_dialogue()
	if mode == "title":
		start_game(false)
	else:
		_set_mode("play")
	_mark_quest_target()
	_refresh_texts()


# ------------------------------------------------------------------ input

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	var k: int = (event as InputEventKey).keycode
	match mode:
		"title":
			if k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_SPACE or k == KEY_E:
				start_game()
			elif k == KEY_L:
				cycle_language()
			elif k == KEY_F9:
				quick_load()
		"cutscene":
			if k == KEY_ESCAPE:
				end_cutscene()
			elif k == KEY_ENTER or k == KEY_SPACE:
				cutscene.call("advance")
		"play":
			if k == KEY_E or k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_SPACE:
				interact()
			elif k == KEY_L:
				cycle_language()
			elif k == KEY_F5:
				quick_save()
			elif k == KEY_F9:
				quick_load()
			else:
				return
			get_viewport().set_input_as_handled()
		"shop":
			if k == KEY_ESCAPE:
				close_shop()
		"battle":
			return


# ------------------------------------------------------------------ Easy NPC: villagers on their daily schedule

func _setup_npcs() -> void:
	if not feat.get("npc", false) or NPCS == null:
		feat["npc"] = false
		return
	var spec: Dictionary = kit.get("npcSchedule", {})
	NPCS.lang = I18n.get_locale()
	var start := str(spec.get("start", "07:00")).split(":")
	NPCS.set_time(0, float(int(start[0]) * 60 + int(start[1])))
	var spm := float(NPCS.world.get("clock", {}).get("secondsPerMinute", 1.0))
	NPCS.time_scale = spm / maxf(0.01, float(spec.get("secondsPerMinute", spm)))
	NPCS.running = false
	for map_name in spec.get("map", {}):
		if not npcs.has(map_name) or NPCS.npc(str(spec["map"][map_name])) == null:
			continue
		var s: AnimatedSprite2D = npcs[map_name]
		s.set_script(null)
		for ch in s.get_children():
			if ch is StaticBody2D:
				ch.queue_free()
		scheduled[map_name] = str(spec["map"][map_name])
	night_tint = CanvasModulate.new()
	world.add_child(night_tint)
	_tick_npcs()


func time_of_day() -> String:
	if not feat.get("npc", false):
		return "morning"
	if NPCS.is_night():
		return "night"
	var m := float(NPCS.minute)
	return "morning" if m < 660.0 else ("noon" if m < 960.0 else "evening")


## Place the scheduled villagers (Easy NPC state in tiles → map pixels, feet anchored like Easy Tilemap).
func _tick_npcs() -> void:
	if not feat.get("npc", false):
		return
	for map_name in scheduled:
		var st = NPCS.state(scheduled[map_name])
		if st == null:
			continue
		var s: AnimatedSprite2D = npcs[map_name]
		s.position = Vector2(roundf(float(st["x"]) * 16.0 + 8.0), roundf(float(st["y"]) * 16.0 + 15.0))
		s.visible = not bool(st["indoors"])
		var anim := ("walk_" if bool(st["moving"]) else "idle_") + str(st["facing"])
		if s.sprite_frames and s.sprite_frames.has_animation(anim) and s.animation != anim:
			s.play(anim)
	var days := {"th": {"mon": "จันทร์", "tue": "อังคาร", "wed": "พุธ", "thu": "พฤหัสฯ", "fri": "ศุกร์", "sat": "เสาร์", "sun": "อาทิตย์"}, "ms": {"mon": "Isnin", "tue": "Selasa", "wed": "Rabu", "thu": "Khamis", "fri": "Jumaat", "sat": "Sabtu", "sun": "Ahad"}}
	var wd := str(NPCS.weekday())
	var dname: String = days.get(I18n.get_locale(), {}).get(wd, wd.capitalize())
	if clock_label:
		set_text(clock_label, "%s %s%s" % [dname, NPCS.time_text(), " ☾" if NPCS.is_night() and not clock_label.has_meta("easyfont") else ""])
	if night_tint:
		night_tint.color = Color(0.55, 0.6, 0.85) if NPCS.is_night() else Color.WHITE


# ------------------------------------------------------------------ Easy Portrait: blink + talk over the dialogue box

func _talk_portrait(ev: Dictionary) -> void:
	if not feat.get("portrait", false) or PORTRAITS == null:
		return
	var base := box.get_node_or_null("Portrait") as TextureRect
	var pid := str(ev.get("portrait", "")) if ev.get("portrait") != null else ""
	if base == null or pid == "" or not PORTRAITS.has(pid):
		if talker:
			talker.visible = false
		return
	if talker == null:
		talker = (load("res://easyportrait/easy_portrait.gd") as GDScript).new()
		talker.name = "KitTalker"
		box.add_child(talker)
	talker.set("character", pid)
	talker.set("emotion", str(ev.get("emotion", "neutral")) if ev.get("emotion") != null else "neutral")
	talker.position = base.position
	talker.size = base.size
	talker.visible = base.visible
	base.self_modulate.a = 0.0 if talker.visible else 1.0
	talker.call("say", clampf(float(str(ev.get("text", "")).length()) / 40.0, 0.4, 4.0))
	events.append("portrait:%s" % pid)


# ------------------------------------------------------------------ Easy Battle: paddy-field encounters

func _setup_battle() -> void:
	if not feat.get("battle", false) or BATTLE == null:
		feat["battle"] = false
		return
	var spec: Dictionary = kit["battle"]
	var ids: Array = []
	var lvl := 1
	for p in spec.get("party", []):
		ids.append(str(p["id"]))
		lvl = maxi(lvl, int(p.get("level", 1)))
	BATTLE.reset_party(ids, lvl)
	BATTLE.lang = I18n.get_locale()
	BATTLE.connect("battle_ended", _on_battle_end)
	battle_layer = CanvasLayer.new()
	battle_layer.layer = 9
	add_child(battle_layer)


func in_battle_zone(pos: Vector2) -> bool:
	if not feat.get("battle", false):
		return false
	var z: Array = kit["battle"]["zone"]
	var t := Vector2i(floori(pos.x / 16.0), floori(pos.y / 16.0))
	return t.x >= int(z[0]) and t.y >= int(z[1]) and t.x < int(z[2]) and t.y < int(z[3])


func _check_encounter() -> void:
	if mode != "play" or not in_battle_zone(player.position):
		return
	var t := Vector2i(floori(player.position.x / 16.0), floori(player.position.y / 16.0))
	if t == _last_tile:
		return
	_last_tile = t
	var spec: Dictionary = kit["battle"]
	var setup: Dictionary
	if not flags.get("battle_first", false):
		setup = BATTLE.scripted(str(spec["table"]), int(spec.get("firstSeed", 7)))
	else:
		setup = BATTLE.step("", str(spec.get("culture", "")), str(spec.get("ground", "C")))
	if not setup.is_empty():
		start_battle(setup)


func start_battle(setup: Dictionary, opts := {}) -> Node:
	flags["battle_first"] = true
	battles += 1
	events.append("battle:" + str(setup.get("table", "")))
	_set_mode("battle")
	prompt.text = ""
	var o := {"lang": I18n.get_locale()}
	o.merge(opts, true)
	battle_scene = BATTLE.start(setup, battle_layer, o)
	return battle_scene


func _on_battle_end(result: String, rewards: Dictionary) -> void:
	events.append("battle_end:" + result)
	battle_scene = null
	var c := int(rewards.get("coins", 0))
	if result == "win" and c > 0:
		Items.state["coins"] = int(Items.state.get("coins", 0)) + c
		Items.coins_changed.emit(int(Items.state["coins"]))
	if result == "win":
		flags["battle_won"] = true
		show_toast(I18n.t("kit.battle.win", {"n": c}))
	elif result == "lose":
		BATTLE.heal_party()
		show_toast(I18n.t("kit.battle.lose"))
	else:
		show_toast(I18n.t("kit.battle.fled"))
	_set_mode("play")
	MusicPlayer.play(kit["music"]["world"], 0.6)
	_refresh_texts()
