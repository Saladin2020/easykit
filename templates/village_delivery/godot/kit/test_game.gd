extends SceneTree
## Easy Kit headless gameplay test (village_delivery template).
##   godot --headless --path . --script res://kit/test_game.gd
## Plays the whole loop through the game API: title → intro cutscene → walk → four NPC dialogue segments
## (quest start → temple → farm → elder → ending) → shop purchase → FX / music / SFX → quick save + load →
## th / en / ms switching. Exit code 0 when every check passes.

var game
var frame := 0
var failed := 0
var passed := 0
var started := false


func check(ok: bool, what: String) -> void:
	if ok:
		passed += 1
		print("  ok   ", what)
	else:
		failed += 1
		print("  FAIL ", what)


func al(n: String) -> Node:
	return root.get_node("/root/" + n)


func _initialize() -> void:
	game = (load("res://kit/main.tscn") as PackedScene).instantiate()
	root.add_child(game)


func drive_dialogue() -> int:
	var box = game.box
	var guard := 0
	while game.mode == "dialogue" and guard < 400:
		guard += 1
		if box.state == "choices":
			box.choose(0)
		else:
			box.advance()
			box._process(0.0)
	return guard


func near(npc: String) -> void:
	var n: Node2D = game.npcs[npc]
	game.player.position = n.position + Vector2(0, 14)
	game.near = npc


func _process(_delta: float) -> bool:
	frame += 1
	if frame < 3 or started:
		return false
	started = true
	run()
	if passed == 0:
		failed += 1
	print("EASYKIT TEST %s · %d passed · %d failed" % ["OK" if failed == 0 else "FAILED", passed, failed])
	quit(0 if failed == 0 else 1)
	return true


func run() -> void:
	var Q = al("QuestManager")
	var I = al("I18n")
	var IT = al("Items")
	var M = al("MusicPlayer")
	var S = al("SfxBank")
	var q: String = game.kit["quest"]["main"]
	if game.get_script() == null or not ("kit" in game) or game.kit.is_empty():
		check(false, "res://kit/game.gd failed to load")
		return
	print("Easy Kit · ", game.kit["name"], " · template ", game.kit["template"], " · seed ", game.kit["seed"])

	# boot
	check(game.mode == "title", "starts on the title screen (Easy Scene backdrop)")
	check(game.title_layer != null and (game.title_layer.get_node("Title") as Label).text != "", "title text from kit.json")
	check(game.npcs.size() >= 8, "map NPCs found (%d)" % game.npcs.size())
	check(game.player != null and game.player_sprite.sprite_frames.has_animation("walk_right"), "player is the Easy Sprite sheet with walk animations")
	check(game.world.get_node("Collision").get_child_count() > 10, "Easy Tilemap collision boxes present")

	# languages
	for loc in ["en", "ms", "th"]:
		game.set_language(loc)
		check(I.get_locale() == loc and game.box.runner.doc.get("lang", "") == loc, "language %s: I18n + dialogue reloaded" % loc)
	game.set_language("en")
	check(I.t("kit.quest.none") == "Find Auntie Daeng at the market", "English string table")
	game.set_language("ms")
	check(I.t("kit.npc.pa_daeng.name") == "Mak Daeng", "Malay string table")
	game.set_language("th")

	# cutscene
	game.start_game()
	check(game.mode == "cutscene" and game.cutscene != null, "intro cutscene playing (Easy Anim)")
	check(game.cutscene.data.get("id", "") == game.kit["cutscene"], "cutscene id %s" % game.kit["cutscene"])
	game.end_cutscene()
	check(game.mode == "play", "cutscene skipped → play")
	check(M.ids().has(game.kit["music"]["world"]) and M.stream_of(game.kit["music"]["world"]) != null, "Easy Music stream %s" % game.kit["music"]["world"])
	check(S.has_sound("coin") and S.stream("coin") != null, "Easy SFX coin sound")

	# walking
	var p0: Vector2 = game.player.position
	for i in 30:
		game.walk(Vector2.LEFT, 1.0 / 60.0)
	check(game.player.position.distance_to(p0) > 8.0, "player walks (%.1f px)" % game.player.position.distance_to(p0))
	check(game.player_sprite.animation == "walk_left", "walk animation plays")

	# quest loop
	var coins0 := int(IT.state["coins"])
	near("pa_daeng")
	check(game.interact() == "dialogue:market", "talk to Auntie Daeng → market segment")
	drive_dialogue()
	check(Q.status(q) == "active", "quest started")
	check(Q.step_done(q, "accept"), "step accept done")
	check(int(IT.state["coins"]) == coins0 + 10, "snack money paid into the Easy Items wallet (%d → %d)" % [coins0, IT.state["coins"]])
	check(game.quest_target() == "luang_phi", "next target marked: the monk")
	check(game.interact("ta_poem") == "bark", "Grandpa Phoem waits his turn (bark)")
	near("luang_phi")
	check(game.interact() == "dialogue:temple", "temple segment")
	drive_dialogue()
	check(Q.step_done(q, "temple"), "step temple done")
	near("lung_mee")
	check(game.interact() == "dialogue:farm", "farm segment (Uncle Mee, added by Easy Kit)")
	drive_dialogue()
	check(Q.step_done(q, "farm") and bool(Q.vars.get("mango", false)), "step farm done, mango bonus")
	near("ta_poem")
	check(game.interact() == "dialogue:elder", "elder segment")
	drive_dialogue()
	check(Q.status(q) == "completed", "quest completed")
	check(game.events.has("complete:" + q), "quest_completed handled (level-up FX + toast)")
	near("pa_daeng")
	check(game.interact() == "dialogue:ending", "ending segment back at the market")
	drive_dialogue()
	check(game.flags.get("ending_seen", false), "ending seen")
	check(IT.count("kanom_chan") >= 1, "reward item mirrored into the inventory")

	# shop
	near("bang_roti")
	check(game.interact() == "shop", "Bang Roti opens the halal stall")
	check(game.mode == "shop" and game.shop != null, "Easy Items shop UI open")
	var before := int(IT.state["coins"])
	var r: Dictionary = IT.buy(game.kit["shop"], "teh_tarik")
	check(r.get("ok", false) and int(IT.state["coins"]) < before, "bought teh tarik (%d → %d)" % [before, IT.state["coins"]])
	game.close_shop()
	check(game.mode == "play", "shop closed")

	# fx
	var spawned = EasyFx.spawn(game.world_layer, "coin_burst", game.player.position)
	check(spawned != null, "Easy FX coin_burst spawns")
	for id in game.kit["fx"]:
		check(ResourceLoader.exists("res://easyfx/scenes/%s.tscn" % id), "fx scene %s" % id)

	# save / load
	var pos: Vector2 = game.player.position
	var money := int(IT.state["coins"])
	var saved: Dictionary = game.quick_save()
	check(saved.get("ok", false) and str(saved.get("slot", {}).get("checksum", "")).length() > 0, "quick save (Easy Save checksum %s)" % str(saved.get("slot", {}).get("checksum", "?")).left(12))
	game.player.position += Vector2(120, 40)
	IT.state["coins"] = 0
	game.flags.clear()
	var loaded: Dictionary = game.quick_load()
	check(loaded.get("ok", false), "quick load")
	check(game.player.position.distance_to(pos) < 0.5, "position restored")
	check(int(IT.state["coins"]) == money, "wallet restored (%d)" % money)
	check(Q.status(q) == "completed" and game.flags.get("ending_seen", false), "quest + flags restored")

	# optional tools (Easy Portrait / NPC / Font / Battle) when this build has them
	var feat: Dictionary = game.kit.get("features", {})
	if feat.get("font", false):
		var EF = al("EasyFont")
		check(EF.font(str(game.kit["font"]["hud"])) != null, "Easy Font %s loaded" % game.kit["font"]["hud"])
		check(EF.shape("น้ำ") != "น้ำ", "Thai shaped for the pixel font (น้ำ → presentation forms)")
		check(game.prompt.has_meta("easyfont"), "HUD labels use the มะขาม pixel font")
		var doc: Dictionary = game.box.runner.doc
		check(str(doc.get("assets", {}).get("fontFiles", {}).get("body", "")).ends_with(".fnt"), "dialogue box uses the pixel font")
	if feat.get("portrait", false):
		var P = al("Portraits")
		for pid in game.kit["portraits"]["ids"]:
			check(P.has(pid) and P.texture(pid, "happy") != null, "Easy Portrait %s (blink + talk strips)" % pid)
		game.set_language("th")
		near("pa_daeng")
		game.flags["ending_seen"] = false
		game.interact()
		var box = game.box
		box.advance()
		box._process(0.0)
		game._talk_portrait(box.current_line)
		check(game.talker != null and game.talker.visible and str(game.talker.get("character")).begins_with("town_"), "animated portrait over the dialogue box (%s)" % (game.talker.get("character") if game.talker else "-"))
		drive_dialogue()
		game.flags["ending_seen"] = true
	if feat.get("npc", false):
		var N = al("NPCs")
		check(game.scheduled.size() >= 3, "villagers on Easy NPC schedules (%d)" % game.scheduled.size())
		var moved: Array = []
		for who in game.scheduled:
			N.set_time(0, 7.0 * 60.0)
			game._tick_npcs()
			var a: Vector2 = game.npcs[who].position
			N.set_time(0, 13.0 * 60.0)
			game._tick_npcs()
			if a.distance_to(game.npcs[who].position) > 4.0:
				moved.append(who)
		check(moved.size() >= 2, "villagers move with the clock 07:00 → 13:00 (%s)" % ", ".join(moved))
		check(game.clock_label.text != "", "clock in the HUD")
		N.set_time(0, 23.0 * 60.0)
		game._tick_npcs()
		check(game.time_of_day() == "night", "night at 23:00")
		N.set_time(0, 9.0 * 60.0)
		game._tick_npcs()
	if feat.get("battle", false):
		var B = al("Battle")
		var spec: Dictionary = game.kit["battle"]
		check(B.party.size() == spec["party"].size() and str(B.party[0]["id"]) == str(spec["party"][0]["id"]), "Easy Battle party: %s" % ", ".join(B.party.map(func(x): return str(x["id"]))))
		check(ResourceLoader.exists("res://easybattle/heroes/%s.png" % spec["party"][0]["id"]), "hero sheet from Easy Sprite")
		var z: Array = spec["zone"]
		check(game.in_battle_zone(Vector2((float(z[0]) + 1.0) * 16.0, (float(z[1]) + 1.0) * 16.0)) and not game.in_battle_zone(game.npcs["pa_daeng"].position) and not game.in_battle_zone(game.npcs["lung_mee"].position + Vector2(-26, 10)), "paddy-field encounter zone (Uncle Mee stays reachable)")
		var setup: Dictionary = B.scripted(str(spec["table"]), int(spec.get("firstSeed", 7)))
		check(setup.get("enemies", []).size() > 0, "scripted encounter %s: %s" % [spec["table"], ", ".join(setup.get("enemies", []).map(func(e): return str(e["id"])))])
		var full := setup.duplicate(true)
		full["party"] = B.party.duplicate(true)
		var eng := EasyBattleEngine.new(B.db, full)
		eng.auto_run()
		check(eng.over == "win", "the party wins the first field battle (auto, seed %d)" % int(setup.get("seed", 0)))
		var coins_b := int(IT.state["coins"])
		var sc: Node = game.start_battle(setup)
		check(game.mode == "battle" and sc != null and sc.is_inside_tree(), "battle scene opens over the village")
		game._on_battle_end("win", {"coins": 6})
		sc.queue_free()
		check(game.mode == "play" and int(IT.state["coins"]) == coins_b + 6, "battle rewards paid into the wallet")

	# language after load
	game.set_language("ms")
	var title: String = (game.hud.get_node("Quest/Title") as Label).text
	check(title != "" and not RegEx.create_from_string("[\\x{0E01}-\\x{0E5B}]").search(title), "HUD in Malay: %s" % title)
	game.set_language("th")
