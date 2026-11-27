import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "th" | "en";

const T = {
  studio: ["สตูดิโอ", "Studio"],
  kit: ["ชุดเครื่องมือ", "Kit & tools"],
  tagline: ["แก้ game.easy.json · ตรวจ · บิลด์ · เล่น · แพ็ก — ทั้งหมดบนเครื่องนี้", "Edit game.easy.json · validate · build · play · ship — all on this machine"],
  projects: ["โปรเจกต์เกม", "Game projects"],
  folder: ["โฟลเดอร์", "Folder"],
  noProjects: ["ยังไม่มีโปรเจกต์ในโฟลเดอร์นี้", "No projects in this folder yet"],
  newGame: ["เกมใหม่", "New game"],
  newHint: ["สร้าง game.easy.json จากเทมเพลต แล้วกด บิลด์", "Creates a game.easy.json from a template; then press Build"],
  name: ["ชื่อ (อังกฤษ)", "Name (latin)"],
  template: ["เทมเพลต", "Template"],
  create: ["สร้าง", "Create"],
  open: ["เปิด", "Open"],
  initFrom: ["สร้าง game.easy.json จากโปรเจกต์นี้", "Create game.easy.json from this project"],
  legacy: ["โปรเจกต์ Easy Kit แบบเก่า (ยังไม่มี game.easy.json)", "Legacy Easy Kit project (no game.easy.json)"],
  neverBuilt: ["ยังไม่เคยบิลด์", "never built"],
  lastBuild: ["บิลด์ล่าสุด", "Last build"],
  edit: ["แก้ไข", "Edit"],
  build: ["บิลด์", "Build"],
  preview: ["ตัวอย่าง", "Preview"],
  ship: ["แพ็กเกม", "Ship"],
  back: ["← โปรเจกต์ทั้งหมด", "← All projects"],
  form: ["ฟอร์ม", "Form"],
  raw: ["JSON ดิบ", "Raw JSON"],
  save: ["บันทึก", "Save"],
  saved: ["บันทึกแล้ว", "Saved"],
  unsaved: ["ยังไม่บันทึก", "Unsaved changes"],
  revert: ["ย้อนกลับ", "Revert"],
  checking: ["กำลังตรวจ…", "Validating…"],
  valid: ["ไม่พบปัญหา ✓", "No problems ✓"],
  issues: ["ปัญหา", "Problems"],
  errors: ["ข้อผิดพลาด", "errors"],
  warnings: ["คำเตือน", "warnings"],
  jsonError: ["JSON ไม่ถูกต้อง", "Invalid JSON"],
  add: ["+ เพิ่ม", "+ Add"],
  addField: ["+ เพิ่มส่วนนี้", "+ Add this"],
  remove: ["ลบ", "Remove"],
  key: ["คีย์", "key"],
  sections: ["หมวด", "Sections"],
  buildNow: ["บิลด์เกม", "Build game"],
  building: ["กำลังบิลด์…", "Building…"],
  force: ["บิลด์ใหม่ทั้งหมด", "Force rebuild"],
  engine: ["เอนจิน", "Engine"],
  fromManifest: ["ตาม manifest", "from manifest"],
  stepsLog: ["ขั้นตอน", "Steps"],
  log: ["บันทึกการทำงาน", "Log"],
  report: ["รายงานบิลด์", "Build report"],
  built: ["บิลด์แล้ว", "built"],
  skipped: ["ข้าม", "skipped"],
  failed: ["ล้มเหลว", "failed"],
  running: ["กำลังทำ", "running"],
  notInstalled: ["ไม่ได้ติดตั้ง", "not installed"],
  saveFirst: ["มีการแก้ที่ยังไม่บันทึก — บันทึกก่อนบิลด์", "Unsaved edits — save before building"],
  play: ["เล่นเวอร์ชันเว็บ (Pixi)", "Play the web build (Pixi)"],
  reload: ["โหลดใหม่", "Reload"],
  newTab: ["เปิดแท็บใหม่", "Open in new tab"],
  noWeb: ["ยังไม่มีเวอร์ชันเว็บ — บิลด์ด้วยเอนจิน pixi หรือ both", "No web build yet — build with engine pixi or both"],
  shots: ["ภาพจากการตรวจอัตโนมัติล่าสุด", "Latest check screenshots"],
  noShots: ["ยังไม่มีภาพ — กด ตรวจอัตโนมัติ", "No screenshots yet — run the headless check"],
  runCheck: ["ตรวจอัตโนมัติ (headless)", "Run headless check"],
  checkingRun: ["กำลังตรวจ… (อาจใช้เวลา 1 นาที)", "Checking… (can take a minute)"],
  desktop: ["เปิดในโปรแกรมบนเครื่อง", "Open in desktop apps"],
  openGodot: ["เปิดโปรเจกต์ใน Godot", "Open project in Godot"],
  openAseprite: ["เปิดใน Aseprite", "Open in Aseprite"],
  pickAsset: ["เลือกไฟล์ภาพ", "Pick an image"],
  notFound: ["ไม่พบ", "not found"],
  shipHint: ["แพ็กไฟล์เกมไว้ในเครื่อง (.easy/ship/releases) — ไม่อัปโหลดขึ้นที่ไหนเลย", "Packages releases locally (.easy/ship/releases) — never uploads anywhere"],
  shipNow: ["แพ็กเกมในเครื่อง", "Ship locally"],
  shipping: ["กำลังแพ็ก…", "Packaging…"],
  targets: ["ปลายทาง", "Targets"],
  noShip: ["ยังไม่มีหมวด ship ใน game.easy.json", "No ship section in game.easy.json yet"],
  releases: ["ไฟล์ที่ได้", "Release files"],
  tools: ["เครื่องมือ", "Tools"],
} as const;

export type Key = keyof typeof T;

/** Section names for the manifest form (key → [th, en]). */
export const SECTION_NAMES: Record<string, [string, string]> = {
  game: ["ข้อมูลเกม", "Game"],
  sprites: ["ตัวละคร (สไปรต์)", "Sprites"],
  portraits: ["ภาพหน้าตัวละคร", "Portraits"],
  scenes: ["ฉากด้านข้าง", "Scenes"],
  tilemaps: ["แผนที่", "Tilemaps"],
  npcs: ["ชาวบ้าน (NPC)", "NPCs"],
  dialogue: ["บทสนทนา", "Dialogue"],
  quests: ["เควสต์", "Quests"],
  items: ["ไอเท็มและร้านค้า", "Items & shops"],
  battle: ["การต่อสู้", "Battle"],
  systems: ["ระบบเกม", "Game systems"],
  action: ["Easy Action (กระโดด ปีน ต่อสู้เรียลไทม์)", "Easy Action (jump, climb, real-time fights)"],
  ui: ["หน้าจอ UI", "UI"],
  fx: ["เอฟเฟกต์", "Effects"],
  sfx: ["เสียงประกอบ", "Sound effects"],
  music: ["ดนตรี", "Music"],
  anim: ["คัตซีน", "Cutscenes"],
  save: ["เซฟและภาษา", "Save & i18n"],
  ship: ["แพ็กเกม", "Ship"],
};

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "th", setLang: () => undefined });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("easystudio.lang") === "en" ? "en" : "th"));
  useEffect(() => {
    localStorage.setItem("easystudio.lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLang() {
  const { lang, setLang } = useContext(Ctx);
  const t = (k: Key) => T[k][lang === "th" ? 0 : 1];
  return { lang, setLang, t };
}

export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button className={lang === "th" ? "on" : ""} onClick={() => setLang("th")}>
        ไทย
      </button>
      <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>
        EN
      </button>
    </div>
  );
}
