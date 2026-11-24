/** Easy Studio API client (shapes mirror src/server/studio.ts and src/lib/build.ts). */
export interface Issue {
  severity: "error" | "warning";
  code: string;
  path: string;
  th: string;
  en: string;
}
export interface StudioProject {
  dir: string;
  root: string;
  manifest: boolean;
  legacy: boolean;
  name: string;
  title: { th: string; en: string; ms?: string } | null;
  engine: string | null;
  built: { godot: boolean; web: boolean };
  lastBuild: { ok: boolean; ms: number; startedAt: string; built: number; skipped: number; failed: number } | null;
  thumb: string | null;
  error?: string;
}
export interface StepReport {
  tool: string;
  title: string;
  status: "built" | "skipped" | "failed" | "not-installed";
  reason: string;
  ms: number;
  outputs: string[];
  notes: string[];
  error?: string;
}
export interface BuildReport {
  ok: boolean;
  ms: number;
  startedAt: string;
  order: string[];
  steps: StepReport[];
  issues: Issue[];
  game: { name: string; engine: string };
}
export interface StudioInfo {
  projects: string;
  templates: string[];
  platform: string;
  godot: string | null;
  aseprite: string | null;
  busy: Record<string, string>;
}
export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | false;
  prefixItems?: JsonSchema[];
  additionalProperties?: JsonSchema | boolean;
  enum?: (string | number)[];
  const?: unknown;
  default?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
const send = (method: string, url: string, body?: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = (dir: string) => `/api/studio/p/${encodeURIComponent(dir)}`;

export const studio = {
  info: () => fetch("/api/studio/info").then((r) => json<StudioInfo>(r)),
  schema: () => fetch("/api/studio/schema").then((r) => json<JsonSchema>(r)),
  projects: () => fetch("/api/studio/projects").then((r) => json<{ root: string; projects: StudioProject[]; busy: Record<string, string> }>(r)),
  create: (body: { name?: string; from?: string; template?: string }) => send("POST", "/api/studio/projects", body).then((r) => json<{ ok: boolean; dir: string }>(r)),
  manifest: (dir: string) => fetch(`${P(dir)}/manifest`).then((r) => json<{ file: string; text: string; json: unknown }>(r)),
  save: (dir: string, manifest: unknown) => send("PUT", `${P(dir)}/manifest`, { manifest }).then((r) => json<{ ok: boolean; issues: Issue[] }>(r)),
  validate: (dir: string, manifest?: unknown) => send("POST", `${P(dir)}/validate`, { manifest }).then((r) => json<{ ok: boolean; issues: Issue[] }>(r)),
  report: (dir: string) => fetch(`${P(dir)}/report`).then((r) => (r.status === 404 ? null : json<{ report: BuildReport; markdown: string }>(r))),
  shots: (dir: string) => fetch(`${P(dir)}/shots`).then((r) => json<{ shots: { file: string; url: string; mtime: string | null }[] }>(r)),
  check: (dir: string) => send("POST", `${P(dir)}/check`, {}).then((r) => json<{ ok: boolean; runs: { name: string; ok: boolean; skipped?: string; ms: number; tail: string }[] }>(r)),
  assets: (dir: string) => fetch(`${P(dir)}/assets`).then((r) => json<{ assets: string[] }>(r)),
  open: (dir: string, app: "godot" | "aseprite", file?: string) => send("POST", `${P(dir)}/open`, { app, file }).then((r) => json<{ ok: boolean; bin: string }>(r)),
  ship: (dir: string) =>
    send("POST", `${P(dir)}/ship`, {}).then((r) => json<{ ok: boolean; uploaded: false; workspace: string; releases: string[]; runs: { id: string; ok: boolean; command: string; output: string }[] }>(r)),
};

export type BuildEvent =
  | { event: "start"; data: { tool: string; title: string; reason: string } }
  | { event: "step"; data: StepReport }
  | { event: "log"; data: string }
  | { event: "done"; data: { report: BuildReport; markdown: string } }
  | { event: "fail"; data: { error: string } }
  | { event: "hello"; data: { dir: string } };

/** POST /build and stream its server-sent events. */
export async function streamBuild(dir: string, opts: { force?: boolean; engine?: string }, on: (e: BuildEvent) => void): Promise<void> {
  const res = await send("POST", `${P(dir)}/build`, opts);
  if (!res.ok || !res.body) {
    await json(res);
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) on({ event, data: JSON.parse(data.join("\n")) } as BuildEvent);
    }
  }
}
