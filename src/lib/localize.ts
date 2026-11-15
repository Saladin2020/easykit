/** Dialogue post-processing for kit games: split a linear story into per-NPC segments and localize it. */

export type Locale = "th" | "en" | "ms";
export const LOCALES: Locale[] = ["th", "en", "ms"];
export type StringTable = Record<string, Partial<Record<Locale, string>> & { th: string }>;

type Stmt = Record<string, any>;

function visit(body: unknown, fn: (s: Stmt) => void): void {
  if (!Array.isArray(body)) return;
  for (const s of body as Stmt[]) {
    if (!s || typeof s !== "object") continue;
    fn(s);
    visit(s.body, fn);
    visit(s.else, fn);
    if (Array.isArray(s.options)) for (const o of s.options) (fn(o), visit(o.body, fn));
    if (Array.isArray(s.branches)) for (const b of s.branches) visit(b.body, fn);
  }
}

/**
 * Turn `jump <segment start>` into `end`, so each segment plays on its own and the game starts the next
 * one when the player reaches the right NPC (`box.start("temple")`). Variables carry over via the quest
 * manager. Returns a copy.
 */
export function segmentDialogue<T extends { nodes: Record<string, { body: unknown }> }>(doc: T, segments: string[]): { doc: T; cut: number } {
  const out = structuredClone(doc);
  const starts = new Set(segments);
  let cut = 0;
  for (const node of Object.values(out.nodes)) {
    visit(node.body, (s) => {
      if (s.t === "jump" && starts.has(s.target)) {
        for (const k of Object.keys(s)) if (k !== "src") delete s[k];
        s.t = "end";
        cut++;
      }
    });
  }
  return { doc: out, cut };
}

export interface LocalizeResult<T> {
  doc: T;
  total: number;
  translated: number;
  missing: string[];
}

/** Swap line, choice and speaker-name text for `locale` using Easy Save keys dlg.<doc>.<id> (fallback: en → th source). */
export function localizeDialogue<T extends { id: string; nodes: Record<string, { body: unknown }>; characters?: Record<string, { name?: string }>; lang?: string }>(doc: T, strings: StringTable, locale: Locale): LocalizeResult<T> {
  const out = structuredClone(doc);
  const prefix = `dlg.${doc.id}.`;
  let total = 0;
  let translated = 0;
  const missing: string[] = [];
  const pick = (key: string): string | null => {
    const e = strings[key];
    if (!e) return null;
    return e[locale] || (locale === "th" ? e.th : e.en || null);
  };
  const swap = (key: string, cur: string): string => {
    total++;
    if (locale === "th") return (translated++, cur);
    const t = pick(key);
    if (t && strings[key]?.[locale]) translated++;
    else missing.push(key);
    return t ?? cur;
  };
  for (const node of Object.values(out.nodes)) {
    visit(node.body, (s) => {
      if ((s.t === "line" || s.text !== undefined) && typeof s.text === "string" && typeof s.id === "string") s.text = swap(prefix + s.id, s.text);
    });
  }
  for (const [cid, c] of Object.entries(out.characters ?? {})) if (typeof c.name === "string") c.name = swap(`${prefix}char.${cid}`, c.name);
  out.lang = locale;
  return { doc: out, total, translated, missing };
}

/** Merge easyi18n tables into one key → entry map. */
export function mergeTables(tables: Array<{ strings: StringTable }>): StringTable {
  return Object.assign({}, ...tables.map((t) => t.strings));
}
