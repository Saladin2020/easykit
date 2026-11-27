/** DSK-7: on-screen touch controls for phones (Easy UI easyui-touch.js / easyui_touch.gd), configured in game.easy.json `touch`. */
import { z } from "zod";

const KEY = z.string().min(1).max(16);
export const TouchButtonSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/), label: z.string().max(4).optional(), key: KEY }).strict();
export const TouchProfileSchema = z
  .object({ stick: z.enum(["8way", "4way", "horizontal", "vertical", "none"]).default("8way"), buttons: z.array(TouchButtonSchema).max(6).default([]) })
  .strict();
export const TouchSchema = z
  .object({
    /** auto: shown on touch screens only; on / off force it (players can change it in settings). */
    mode: z.enum(["auto", "on", "off"]).default("auto"),
    opacity: z.number().min(0.2).max(1).default(0.6),
    size: z.number().min(0.6).max(2).default(1),
    style: z.enum(["stick", "dpad"]).default("stick"),
    /** Landscape: "auto" shrinks the game for side gutters when it stays ≥ 65% size, "gutters" always, "overlay" never. */
    fit: z.enum(["auto", "gutters", "overlay"]).default("auto"),
    /** Key sent by the top-right menu button. */
    menuKey: KEY.default("Escape"),
    /** Control sets by game mode (map = top-down, street = side-view, action, battle, menu, dialogue); merged over the defaults. */
    profiles: z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]*$/), TouchProfileSchema).optional(),
  })
  .strict();
export type TouchConfig = z.infer<typeof TouchSchema>;
type Profile = z.infer<typeof TouchProfileSchema>;

/** Default control sets: keys the Easy Suite runtimes already read (E / Enter interact, Z wait, Space jump, J / K attack). */
export const DEFAULT_TOUCH_PROFILES: Record<string, Profile> = {
  map: { stick: "8way", buttons: [{ id: "ok", label: "E", key: "e" }, { id: "wait", label: "Z", key: "z" }, { id: "back", label: "B", key: "Escape" }] },
  street: { stick: "horizontal", buttons: [{ id: "ok", label: "E", key: "e" }, { id: "back", label: "B", key: "Escape" }] },
  action: { stick: "8way", buttons: [{ id: "jump", label: "⤒", key: " " }, { id: "hit", label: "J", key: "j" }, { id: "heavy", label: "K", key: "k" }] },
  battle: { stick: "4way", buttons: [{ id: "ok", label: "A", key: "Enter" }, { id: "back", label: "B", key: "x" }] },
  menu: { stick: "4way", buttons: [{ id: "ok", label: "A", key: "Enter" }, { id: "back", label: "B", key: "Escape" }] },
  dialogue: { stick: "4way", buttons: [{ id: "ok", label: "A", key: "Enter" }] },
};

/** What the games read (kit/touch.json): the config with defaults filled in. */
export function touchData(t?: Partial<TouchConfig>): Required<TouchConfig> {
  const c = TouchSchema.parse(t ?? {});
  return { ...c, profiles: { ...DEFAULT_TOUCH_PROFILES, ...(c.profiles ?? {}) } };
}

/** Semantic checks: duplicate button ids / keys within a profile. */
export function checkTouch(t: TouchConfig | undefined): Array<{ path: string; th: string; en: string }> {
  const out: Array<{ path: string; th: string; en: string }> = [];
  for (const [name, p] of Object.entries(t?.profiles ?? {})) {
    const ids = new Set<string>();
    p.buttons.forEach((b, i) => {
      if (ids.has(b.id)) out.push({ path: `touch.profiles.${name}.buttons[${i}]`, th: `ปุ่ม "${b.id}" ซ้ำ`, en: `duplicate button "${b.id}"` });
      ids.add(b.id);
    });
    if (p.stick === "none" && !p.buttons.length) out.push({ path: `touch.profiles.${name}`, th: "ไม่มีปุ่มหรือจอยเลย", en: "no stick and no buttons" });
  }
  return out;
}
