extends SceneTree
## Easy Kit screenshots: title, cutscene, gameplay, dialogue, shop, paddy battle + night village when the build has
## Easy Battle / Easy NPC (+ optional GIF frames).
##   godot --path . --rendering-driver opengl3 --script res://kit/screenshot_game.gd -- --out /tmp/shots [--frames]

var game
var out := "user://shots"
var frames := false
var t := 0
var step := 0
var gif_i := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == "--out" and i + 1 < args.size():
			out = args[i + 1]
		elif args[i] == "--frames":
			frames = true
	DirAccess.make_dir_recursive_absolute(out)
	game = (load("res://kit/main.tscn") as PackedScene).instantiate()
	root.add_child(game)


func shot(name: String) -> void:
	var img := root.get_texture().get_image()
	img.save_png(out.path_join(name + ".png"))
	print("shot ", out.path_join(name + ".png"))


func near(npc: String) -> void:
	var n: Node2D = game.npcs[npc]
	game.player.position = n.position + Vector2(-26, 10)
	game.camera.position = game.player.position
	game.near = ""


func _process(delta: float) -> bool:
	t += 1
	match step:
		0:
			if t == 20:
				shot("01_title")
				game.start_game()
				step = 1
				t = 0
		1:
			if t == 150:
				shot("02_cutscene")
				game.end_cutscene()
				near("pa_daeng")
				step = 2
				t = 0
		2:
			if t < 40:
				game.walk(Vector2.RIGHT * 0.6, delta)
			if t == 50:
				shot("03_gameplay")
				game.interact("pa_daeng")
				step = 3
				t = 0
		3:
			if t == 8:
				game.box.advance()
			if t == 30:
				shot("04_dialogue")
				while game.mode == "dialogue":
					if game.box.state == "choices":
						game.box.choose(0)
					else:
						game.box.advance()
						game.box._process(0.0)
				game.set_language("en")
				near("bang_roti")
				game.interact("bang_roti")
				step = 4
				t = 0
		4:
			if t == 30:
				shot("05_shop_en")
				game.close_shop()
				game.set_language("ms")
				near("luang_phi")
				step = 5
				t = 0
		5:
			if t == 30:
				shot("06_gameplay_ms")
				game.set_language("th")
				step = 7
				t = 0
		7:
			var feat: Dictionary = game.kit.get("features", {})
			if t == 1 and feat.get("battle", false):
				var z: Array = game.kit["battle"]["zone"]
				game.player.position = Vector2((float(z[0]) + 1.5) * 16.0, (float(z[1]) + 4.5) * 16.0)
				game.camera.position = game.player.position
				game.walk(Vector2.RIGHT, 0.2)
			if t == 90 and game.mode == "battle":
				shot("07_battle")
			if t == 100 and game.battle_scene:
				game.battle_scene.queue_free()
				game._on_battle_end("win", {"coins": 0})
			if t == 110 and feat.get("npc", false):
				near("pa_daeng")
				game.NPCS.set_time(0, 20.5 * 60.0)
			if t == 140 and feat.get("npc", false):
				shot("08_night")
				game.NPCS.set_time(0, 9.0 * 60.0)
			if t == 150:
				if not frames:
					return _done()
				step = 8
				t = 0
		8:
			near("pa_daeng")
			game.player.position += Vector2(-60, 30)
			step = 6
			t = 0
		6:
			# ~6 s of walking for a GIF: left → up → right towards the market.
			var dir := Vector2.ZERO
			if t < 90:
				dir = Vector2.RIGHT
			elif t < 150:
				dir = Vector2.UP
			elif t < 260:
				dir = Vector2.RIGHT
			game.walk(dir, delta)
			if t % 3 == 0:
				var img := root.get_texture().get_image()
				img.save_png(out.path_join("gif_%03d.png" % gif_i))
				gif_i += 1
			if t == 200:
				if game.near != "":
					game.interact(game.near)
			if t >= 300:
				return _done()
	return false


func _done() -> bool:
	quit(0)
	return true
