// Writes schema/game.easy.schema.json from the zod schema in src/lib/manifest.ts (test/manifest.test.ts checks it is in sync).
import { writeFileSync } from "node:fs";
import { manifestJsonSchema } from "../src/lib/manifest.js";
writeFileSync(new URL("../schema/game.easy.schema.json", import.meta.url), JSON.stringify(manifestJsonSchema(), null, 2) + "\n");
console.log("wrote schema/game.easy.schema.json");
