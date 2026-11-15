/** Response shapes of the Easy Kit dashboard API (mirrors src/lib; kept here so the web build never pulls Node modules). */
export interface ToolReport {
  id: string;
  name: string;
  pkg: string;
  installed: boolean;
  home: string | null;
  source: string;
  version: string | null;
  git: { commit: string; branch: string; dirty: boolean } | null;
  built: boolean;
  cli: boolean;
  mcp: boolean;
  deps: boolean;
  ports: { serve?: number; mcp: number; vite: number };
  problems: string[];
}
export interface DoctorReport {
  ok: boolean;
  config: string | null;
  tools: ToolReport[];
  engines: { node: string; godot: { path: string | null; version: string | null }; chrome: { path: string | null }; xvfb: boolean };
  summary: string;
}
export interface StepResult {
  tool: string;
  title: string;
  ok: boolean;
  ms: number;
  outputs: string[];
  notes: string[];
  error?: string;
}
export interface ProjectInfo {
  name: string;
  root: string;
  template: string;
  engine: string;
  seed: number;
  ok: boolean;
  createdAt: string;
  godot: boolean;
  web: boolean;
  steps: StepResult[];
  tools: Record<string, { version: string | null; commit: string | null; dirty: boolean }>;
}
export interface TemplateInfo {
  id: string;
  name: { th: string; en: string; ms: string };
  summary: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const fetchDoctor = () => fetch("/api/doctor").then((r) => json<DoctorReport>(r));
export const fetchProjects = () => fetch("/api/projects").then((r) => json<{ root: string; projects: ProjectInfo[]; busy: string[] }>(r));
export const fetchTemplates = () => fetch("/api/templates").then((r) => json<TemplateInfo[]>(r));
export const createProject = (body: { name: string; template: string; engine: string; seed: number; force: boolean }) =>
  fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
    json<{ ok: boolean; manifest: { steps: StepResult[]; ok: boolean } }>(r),
  );
