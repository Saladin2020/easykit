import { useCallback, useEffect, useState } from "react";
import { createProject, fetchDoctor, fetchProjects, fetchTemplates, type DoctorReport, type ProjectInfo, type StepResult, type TemplateInfo } from "./api";

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ToolsPanel({ report, onRefresh }: { report: DoctorReport | null; onRefresh: () => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>เครื่องมือ · Tools</h2>
        <button onClick={onRefresh}>Doctor</button>
      </div>
      {!report ? (
        <p className="muted">Checking the 12 tools…</p>
      ) : (
        <>
          <p className={report.ok ? "ok" : "warn"}>{report.summary}</p>
          <table className="tools">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Version</th>
                <th>Commit</th>
                <th>Home</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.tools.map((t) => (
                <tr key={t.id} className={t.installed ? "" : "missing"}>
                  <td>
                    <b>{t.name}</b>
                  </td>
                  <td className="mono">{t.version ?? "–"}</td>
                  <td className="mono">{t.git ? `${t.git.commit}${t.git.dirty ? "*" : ""}` : "–"}</td>
                  <td className="mono small" title={t.home ?? ""}>
                    {t.home ?? "not found"} <span className="faint">({t.source})</span>
                  </td>
                  <td>{t.problems.length ? <span className="warn">{t.problems.join("; ")}</span> : <span className="ok">ready</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            node {report.engines.node} · godot {report.engines.godot.version ?? "missing"} · chrome {report.engines.chrome.path ? "yes" : "missing"} · xvfb {report.engines.xvfb ? "yes" : "missing"}
          </p>
        </>
      )}
    </section>
  );
}

function Steps({ steps }: { steps: StepResult[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className={s.ok ? "ok" : "warn"} title={s.error ?? s.notes.join("\n")}>
          <span className="mono">{s.tool}</span> {s.title} <span className="faint">{(s.ms / 1000).toFixed(1)}s</span>
          {s.error ? <div className="warn small">{s.error}</div> : null}
        </li>
      ))}
    </ol>
  );
}

function NewProject({ templates, onCreated }: { templates: TemplateInfo[]; onCreated: () => void }) {
  const [name, setName] = useState("VillageDemo");
  const [template, setTemplate] = useState("village_delivery");
  const [engine, setEngine] = useState("both");
  const [seed, setSeed] = useState(7);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [steps, setSteps] = useState<StepResult[]>([]);
  const submit = async () => {
    setBusy(true);
    setError("");
    setSteps([]);
    try {
      const res = await createProject({ name, template, engine, seed, force });
      setSteps(res.manifest.steps);
      if (!res.ok) setError("Some steps failed — see below.");
      onCreated();
    } catch (e) {
      setError(fail(e));
    } finally {
      setBusy(false);
    }
  };
  const tpl = templates.find((t) => t.id === template);
  return (
    <section className="panel">
      <h2>เกมใหม่ · New game</h2>
      <div className="form">
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Template
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Engine
          <select value={engine} onChange={(e) => setEngine(e.target.value)}>
            <option value="both">godot + pixi</option>
            <option value="godot">godot</option>
            <option value="pixi">pixi</option>
          </select>
        </label>
        <label>
          Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> replace
        </label>
        <button className="primary" disabled={busy} onClick={submit}>
          {busy ? "Building with 12 tools…" : "Create"}
        </button>
      </div>
      {tpl ? (
        <p className="muted small">
          {tpl.name.th} · {tpl.name.en} · {tpl.name.ms} — {tpl.summary}
        </p>
      ) : null}
      {error ? <p className="warn">{error}</p> : null}
      {steps.length ? <Steps steps={steps} /> : null}
    </section>
  );
}

function Projects({ root, projects }: { root: string; projects: ProjectInfo[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>โปรเจกต์ · Projects</h2>
      <p className="muted small mono">{root}</p>
      {projects.length === 0 ? <p className="muted">No projects yet.</p> : null}
      {projects.map((p) => (
        <article key={p.name} className="project">
          <div className="project-head">
            <b>{p.name}</b>
            <span className="faint">
              {p.template} · {p.engine} · seed {p.seed} · {new Date(p.createdAt).toLocaleString()}
            </span>
            <span className={p.ok ? "ok" : "warn"}>{p.ok ? "ok" : "has errors"}</span>
          </div>
          <div className="toolbar">
            {p.web ? (
              <a className="button primary" href={`/play/${encodeURIComponent(p.name)}/index.html`} target="_blank" rel="noreferrer">
                Play web build
              </a>
            ) : null}
            {p.godot ? <code className="small">godot --path {p.root}/godot</code> : null}
            <button onClick={() => setOpen(open === p.name ? null : p.name)}>{open === p.name ? "Hide steps" : "Steps"}</button>
          </div>
          {open === p.name ? <Steps steps={p.steps} /> : null}
        </article>
      ))}
    </section>
  );
}

export function App() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [projects, setProjects] = useState<{ root: string; projects: ProjectInfo[] }>({ root: "", projects: [] });
  const [status, setStatus] = useState("");
  const loadDoctor = useCallback(() => {
    setReport(null);
    fetchDoctor().then(setReport, (e) => setStatus(fail(e)));
  }, []);
  const loadProjects = useCallback(() => {
    fetchProjects().then(setProjects, (e) => setStatus(fail(e)));
  }, []);
  useEffect(() => {
    loadDoctor();
    loadProjects();
    fetchTemplates().then(setTemplates, (e) => setStatus(fail(e)));
  }, [loadDoctor, loadProjects]);
  return (
    <>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" />
          <div>
            <h1 className="brand">
              Easy <span>Kit</span>
            </h1>
            <p className="brand-th">สร้างเกมทั้งเกมจาก 12 เครื่องมือในคำสั่งเดียว</p>
          </div>
        </div>
        <div className="status">{status}</div>
      </header>
      <main className="layout">
        <div className="col">
          <NewProject templates={templates} onCreated={loadProjects} />
          <Projects root={projects.root} projects={projects.projects} />
        </div>
        <ToolsPanel report={report} onRefresh={loadDoctor} />
      </main>
    </>
  );
}
