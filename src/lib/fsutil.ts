import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = any>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf8")) as T;
}

export async function writeJson(p: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(data, null, 2)}\n`);
}

export async function writeText(p: string, text: string): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, text);
}

/** Every file under dir, as forward-slash paths relative to dir. */
export async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

export async function sha1(p: string): Promise<string> {
  return createHash("sha1").update(await readFile(p)).digest("hex");
}

export interface CopyReport {
  copied: number;
  skipped: string[];
  collisions: Array<{ path: string; kept: string; dropped: string }>;
}

/**
 * Copy a tree into dest. `exclude` gets the relative path. A file that already exists with different
 * bytes is a collision: the first writer (owner) wins and the clash is reported.
 */
export async function mergeTree(src: string, dest: string, opts: { exclude?: (rel: string) => boolean; owner: string; owners: Map<string, string> }): Promise<CopyReport> {
  const report: CopyReport = { copied: 0, skipped: [], collisions: [] };
  for (const rel of await walk(src)) {
    if (opts.exclude?.(rel)) {
      report.skipped.push(rel);
      continue;
    }
    const to = path.join(dest, rel);
    if (await exists(to)) {
      if ((await sha1(to)) !== (await sha1(path.join(src, rel)))) report.collisions.push({ path: rel, kept: opts.owners.get(rel) ?? "?", dropped: opts.owner });
      continue;
    }
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(path.join(src, rel), to);
    opts.owners.set(rel, opts.owner);
    report.copied++;
  }
  return report;
}

export async function copyTree(src: string, dest: string, exclude?: (rel: string) => boolean): Promise<number> {
  let n = 0;
  for (const rel of await walk(src)) {
    if (exclude?.(rel)) continue;
    await mkdir(path.dirname(path.join(dest, rel)), { recursive: true });
    await copyFile(path.join(src, rel), path.join(dest, rel));
    n++;
  }
  return n;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
