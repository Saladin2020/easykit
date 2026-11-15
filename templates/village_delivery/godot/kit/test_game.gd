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

	# language after load
	game.set_language("ms")
	var title: String = (game.hud.get_node("Quest/Title") as Label).text
	check(title != "" and not RegEx.create_from_string("[\\x{0E01}-\\x{0E5B}]").search(title), "HUD in Malay: %s" % title)
	game.set_language("th")
