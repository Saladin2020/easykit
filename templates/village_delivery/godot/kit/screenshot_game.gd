extends SceneTree
## Easy Kit screenshots: title, cutscene, gameplay, dialogue, shop (+ optional GIF frames).
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
				if not frames:
					return _done()
				game.set_language("th")
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
