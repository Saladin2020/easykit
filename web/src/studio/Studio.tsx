import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { studio, streamBuild, type BuildReport, type Issue, type JsonSchema, type StepReport, type StudioInfo, type StudioProject } from "./api";
import { SECTION_NAMES, useLang } from "./i18n";
import { SectionForm, fieldId, issuePath, setIn, type Path } from "./SchemaForm";

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const go = (hash: string) => {
  window.location.hash = hash;
};

/* ───────────── project list ───────────── */

export function ProjectList({ info }: { info: StudioInfo | null }) {
  const { t, lang } = useLang();
  const [data, setData] = useState<{ root: string; projects: StudioProject[] } | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("MyVillage");
  const [template, setTemplate] = useState("village_delivery");
  const load = useCallback(() => studio.projects().then(setData, (e) => setErr(fail(e))), []);
  useEffect(() => void load(), [load]);
  const create = async (body: { name?: string; from?: string; template?: string }) => {
    setErr("");
    try {
      const r = await studio.create(body);
      go(`#/studio/${r.dir}/edit`);
    } catch (e) {
      setErr(fail(e));
    }
  };
  return (
    <div className="page list-page">
      <section className="panel new-game">
        <h2>{t("newGame")}</h2>
        <p className="muted small">{t("newHint")}</p>
        <div className="form">
          <label>
            {t("name")}
            <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
          <label>
            {t("template")}
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {(info?.templates ?? ["village_delivery"]).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={() => create({ name, template })}>
            {t("create")}
          </button>
        </div>
        {err ? <p className="warn">{err}</p> : null}
        <p className="muted small mono path">
          {t("folder")}: {data?.root ?? info?.projects ?? "…"}
        </p>
      </section>
      <section className="cards">
        {data && data.projects.length === 0 ? <p className="muted">{t("noProjects")}</p> : null}
        {data?.projects.map((p) => (
          <article key={p.dir} className={`card${p.manifest ? "" : " legacy"}`}>
            <div className="thumb">{p.thumb ? <img src={`/api/studio/p/${encodeURIComponent(p.dir)}/shot/${p.thumb}`} alt="" /> : <div className="thumb-empty">{p.dir.slice(0, 2)}</div>}</div>
            <div className="card-body">
              <h3 lang="th">{p.title ? (lang === "th" ? p.title.th : p.title.en) : p.name}</h3>
              {p.title ? <p className="muted small">{lang === "th" ? p.title.en : p.title.th}</p> : null}
              <p className="small mono faint">
                {p.dir} · {p.engine ?? "?"}
                {p.built.godot ? " · godot ✓" : ""}
                {p.built.web ? " · web ✓" : ""}
              </p>
              {p.manifest ? (
                <p className="small">
                  {p.lastBuild ? (
                    <span className={p.lastBuild.ok ? "ok" : "warn"}>
                      {t("lastBuild")}: {p.lastBuild.ok ? "OK" : "FAIL"} · {new Date(p.lastBuild.startedAt).toLocaleString(lang === "th" ? "th-TH" : "en-GB")} · {p.lastBuild.built} {t("built")} / {p.lastBuild.skipped} {t("skipped")}
                    </span>
                  ) : (
                    <span className="faint">{t("neverBuilt")}</span>
                  )}
                </p>
              ) : (
                <p className="small faint">{t("legacy")}</p>
              )}
              {p.error ? <p className="warn small">{p.error}</p> : null}
            </div>
            <div className="card-actions">
              {p.manifest ? (
                <a className="button primary" href={`#/studio/${p.dir}/edit`}>
                  {t("open")}
                </a>
              ) : (
                <button onClick={() => create({ from: p.dir })}>{t("initFrom")}</button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

/* ───────────── project view ───────────── */

type Tab = "edit" | "build" | "preview" | "ship";

export function ProjectView({ dir, tab, info }: { dir: string; tab: Tab; info: StudioInfo | null }) {
  const { t } = useLang();
  const [schema, setSchema] = useState<JsonSchema | null>(null);
  const [saved, setSaved] = useState<unknown>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    studio.schema().then(setSchema, (e) => setErr(fail(e)));
    studio.manifest(dir).then(
      (m) => {
        setSaved(m.json);
        setDraft(m.json);
      },
      (e) => setErr(fail(e)),
    );
  }, [dir]);
  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
  const save = useCallback(async () => {
    try {
      await studio.save(dir, draft);
      setSaved(draft);
    } catch (e) {
      setErr(fail(e));
    }
  }, [dir, draft]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);
  const g = (draft as { game?: { title?: { th?: string; en?: string } } } | null)?.game;
  const tabs: Tab[] = ["edit", "build", "preview", "ship"];
  return (
    <div className="page project-page">
      <div className="project-bar">
        <a href="#/studio" className="back">
          {t("back")}
        </a>
        <h2 lang="th">
          {g?.title?.th ?? dir} <span className="faint small">{g?.title?.en}</span>
        </h2>
        <nav className="tabs" role="tablist">
          {tabs.map((x) => (
            <a key={x} role="tab" aria-selected={tab === x} className={tab === x ? "on" : ""} href={`#/studio/${dir}/${x}`}>
              {t(x)}
            </a>
          ))}
        </nav>
        <div className="save-box">
          {dirty ? <span className="warn small">● {t("unsaved")}</span> : <span className="ok small">{t("saved")}</span>}
          <button className="primary" disabled={!dirty} onClick={save} title="Ctrl+S">
            {t("save")}
          </button>
        </div>
      </div>
      {err ? <p className="warn pad">{err}</p> : null}
      {tab === "edit" && schema && draft ? <Editor dir={dir} schema={schema} draft={draft} setDraft={setDraft} onRevert={() => setDraft(saved)} dirty={dirty} /> : null}
      {tab === "build" ? <BuildPanel dir={dir} dirty={dirty} /> : null}
      {tab === "preview" ? <PreviewPanel dir={dir} info={info} /> : null}
      {tab === "ship" ? <ShipPanel dir={dir} manifest={saved} dirty={dirty} /> : null}
    </div>
  );
}

/* ───────────── editor ───────────── */

function Editor({ dir, schema, draft, setDraft, onRevert, dirty }: { dir: string; schema: JsonSchema; draft: unknown; setDraft: (d: unknown) => void; onRevert: () => void; dirty: boolean }) {
  const { t, lang } = useLang();
  const sections = Object.keys(schema.properties ?? {}).filter((k) => k !== "$schema" && k !== "format");
  const [active, setActive] = useState("game");
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [raw, setRaw] = useState(() => JSON.stringify(draft, null, 2));
  const [rawErr, setRawErr] = useState("");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<string[] | null>(null);
  const seq = useRef(0);

  // live validation (debounced), against the unsaved draft
  useEffect(() => {
    const n = ++seq.current;
    setChecking(true);
    const h = setTimeout(() => {
      studio.validate(dir, draft).then(
        (r) => n === seq.current && (setIssues(r.issues), setChecking(false)),
        (e) => n === seq.current && (setIssues([{ severity: "error", code: "request", path: "(root)", th: fail(e), en: fail(e) }]), setChecking(false)),
      );
    }, 600);
    return () => clearTimeout(h);
  }, [dir, draft]);

  useEffect(() => {
    if (mode === "form") setRaw(JSON.stringify(draft, null, 2));
  }, [draft, mode]);

  const onChange = (p: Path, v: unknown) => setDraft(setIn(draft, p, v));
  const bad = useMemo(() => new Set((issues ?? []).map((i) => issuePath(i.path).join("."))), [issues]);
  const perSection = useMemo(() => {
    const m: Record<string, { e: number; w: number }> = {};
    for (const i of issues ?? []) {
      const s = issuePath(i.path)[0] ?? "";
      m[s] ??= { e: 0, w: 0 };
      m[s][i.severity === "error" ? "e" : "w"]++;
    }
    return m;
  }, [issues]);

  // jump-to-field: switch section, then scroll to the deepest existing element
  useEffect(() => {
    if (!pending) return;
    let p = pending;
    while (p.length) {
      const el = document.getElementById(fieldId(p));
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
        (el.querySelector("input,select,textarea") as HTMLElement | null)?.focus({ preventScroll: true });
        break;
      }
      p = p.slice(0, -1);
    }
    setPending(null);
  }, [pending, active, mode]);

  const jump = (i: Issue) => {
    const p = issuePath(i.path);
    if (mode === "raw") setMode("form");
    if (p[0] && sections.includes(p[0])) setActive(p[0]);
    setPending(p);
  };

  const errors = (issues ?? []).filter((i) => i.severity === "error").length;
  const warnings = (issues ?? []).length - errors;
  const name = (s: string) => SECTION_NAMES[s]?.[lang === "th" ? 0 : 1] ?? s;
  const req = new Set(schema.required ?? []);
  const value = (draft as Record<string, unknown>)[active];

  return (
    <div className="editor">
      <nav className="section-nav" aria-label={t("sections")}>
        <div className="seg">
          <button className={mode === "form" ? "on" : ""} onClick={() => setMode("form")}>
            {t("form")}
          </button>
          <button className={mode === "raw" ? "on" : ""} onClick={() => setMode("raw")}>
            {t("raw")}
          </button>
        </div>
        {sections.map((s) => (
          <button key={s} className={`sec${active === s && mode === "form" ? " on" : ""}`} onClick={() => (setMode("form"), setActive(s))}>
            <span>{name(s)}</span>
            <span className="badges">
              {(draft as Record<string, unknown>)[s] === undefined ? <span className="faint small">—</span> : null}
              {perSection[s]?.e ? <b className="badge err">{perSection[s].e}</b> : null}
              {perSection[s]?.w ? <b className="badge warnb">{perSection[s].w}</b> : null}
            </span>
          </button>
        ))}
        {dirty ? (
          <button className="ghost small revert" onClick={onRevert}>
            {t("revert")}
          </button>
        ) : null}
      </nav>
      <div className="editor-main">
        {mode === "form" ? (
          <SectionForm key={active} section={active} title={`${name(active)} · ${active}`} schema={schema.properties![active]!} value={value} onChange={onChange} bad={bad} required={req.has(active)} />
        ) : (
          <div className="raw">
            {rawErr ? <p className="warn small">{t("jsonError")}: {rawErr}</p> : null}
            <textarea
              aria-label="game.easy.json"
              spellCheck={false}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                try {
                  setDraft(JSON.parse(e.target.value));
                  setRawErr("");
                } catch (x) {
                  setRawErr(fail(x));
                }
              }}
            />
          </div>
        )}
      </div>
      <aside className="issues" aria-live="polite">
        <h3>
          {t("issues")}{" "}
          {checking ? (
            <span className="faint small">{t("checking")}</span>
          ) : issues ? (
            <span className="small">
              <span className={errors ? "warn" : "ok"}>
                {errors} {t("errors")}
              </span>{" "}
              · <span className={warnings ? "gold" : "faint"}>{warnings} {t("warnings")}</span>
            </span>
          ) : null}
        </h3>
        {issues && issues.length === 0 ? <p className="ok">{t("valid")}</p> : null}
        <ul>
          {(issues ?? []).map((i, k) => (
            <li key={k} className={i.severity}>
              <button className="issue" onClick={() => jump(i)}>
                <span className="mono small path">{i.path}</span>
                <span className="msg" lang={lang}>
                  {lang === "th" ? i.th : i.en}
                </span>
                <span className="alt small faint">{lang === "th" ? i.en : i.th}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/* ───────────── build ───────────── */

type Row = StepReport | { tool: string; title: string; status: "running"; reason: string; ms?: number; outputs?: string[]; notes?: string[]; error?: string };

function StatusChip({ s }: { s: Row["status"] }) {
  const { t } = useLang();
  const label = { built: t("built"), skipped: t("skipped"), failed: t("failed"), running: t("running"), "not-installed": t("notInstalled") }[s];
  return <span className={`chip st-${s}`}>{label}</span>;
}

const REASON_TH: Record<string, string> = { unchanged: "ไม่เปลี่ยน", "inputs changed": "ข้อมูลเปลี่ยน", "first build": "บิลด์ครั้งแรก", "workspace edited": "ไฟล์ถูกแก้", "outputs missing": "ไฟล์ผลลัพธ์หาย", "output missing": "ไฟล์ผลลัพธ์หาย", "--force": "บังคับบิลด์ใหม่", "not in --only": "ไม่ได้เลือก" };

function BuildPanel({ dir, dirty }: { dir: string; dirty: boolean }) {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<Row[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const [engine, setEngine] = useState("");
  const [done, setDone] = useState<{ report: BuildReport; markdown: string } | null>(null);
  const [err, setErr] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    studio.report(dir).then((r) => {
      if (r) {
        setDone(r);
        setRows(r.report.steps);
      }
    }, () => undefined);
  }, [dir]);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);
  const run = async () => {
    setBusy(true);
    setErr("");
    setRows([]);
    setLog([]);
    setDone(null);
    try {
      await streamBuild(dir, { force, engine: engine || undefined }, (e) => {
        if (e.event === "log") setLog((l) => [...l, e.data]);
        else if (e.event === "start") setRows((r) => [...r, { ...e.data, status: "running" }]);
        else if (e.event === "step")
          setRows((r) => {
            const i = r.findIndex((x) => x.status === "running" && x.tool === e.data.tool && x.title === e.data.title);
            return i >= 0 ? r.map((x, k) => (k === i ? e.data : x)) : [...r, e.data];
          });
        else if (e.event === "done") setDone(e.data);
        else if (e.event === "fail") setErr(e.data.error);
      });
    } catch (e) {
      setErr(fail(e));
    } finally {
      setBusy(false);
    }
  };
  const rep = done?.report;
  return (
    <div className="build">
      <section className="panel build-controls">
        <div className="form">
          <label>
            {t("engine")}
            <select value={engine} onChange={(e) => setEngine(e.target.value)}>
              <option value="">{t("fromManifest")}</option>
              <option value="both">godot + pixi</option>
              <option value="godot">godot</option>
              <option value="pixi">pixi</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> {t("force")}
          </label>
          <button className="primary big" disabled={busy} onClick={run}>
            {busy ? t("building") : `▶ ${t("buildNow")}`}
          </button>
          {dirty ? <span className="warn small">{t("saveFirst")}</span> : null}
        </div>
        {rep ? (
          <p className={`summary ${rep.ok ? "ok" : "warn"}`}>
            {rep.ok ? "✅ OK" : "❌ FAILED"} · {(rep.ms / 1000).toFixed(1)} s · {rep.steps.filter((s) => s.status === "built").length} {t("built")} · {rep.steps.filter((s) => s.status === "skipped").length} {t("skipped")}
            {rep.steps.some((s) => s.status === "failed") ? ` · ${rep.steps.filter((s) => s.status === "failed").length} ${t("failed")}` : ""} · {new Date(rep.startedAt).toLocaleString(lang === "th" ? "th-TH" : "en-GB")}
          </p>
        ) : null}
        {err ? <p className="warn">{err}</p> : null}
      </section>
      <div className="build-grid">
        <section className="panel">
          <h3>{t("stepsLog")}</h3>
          <table className="steps-table">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`st-${r.status}`}>
                  <td>
                    <StatusChip s={r.status} />
                  </td>
                  <td className="mono small">{r.tool}</td>
                  <td>
                    {r.title}
                    {r.error ? <pre className="warn small err-pre">{r.error}</pre> : null}
                  </td>
                  <td className="faint small">{lang === "th" ? (REASON_TH[r.reason] ?? r.reason) : r.reason}</td>
                  <td className="faint small num">{r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rep?.issues.length ? (
            <ul className="report-issues">
              {rep.issues.map((i, k) => (
                <li key={k} className={i.severity}>
                  <code>{i.path}</code> {lang === "th" ? i.th : i.en}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="panel">
          <h3>{t("log")}</h3>
          <pre className="log" ref={logRef}>
            {log.length ? log.join("\n") : "—"}
          </pre>
          {done ? (
            <details className="report-md">
              <summary>BUILD-REPORT.md</summary>
              <pre>{done.markdown}</pre>
            </details>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* ───────────── preview ───────────── */

function PreviewPanel({ dir, info }: { dir: string; info: StudioInfo | null }) {
  const { t } = useLang();
  const [nonce, setNonce] = useState(Date.now());
  const [web, setWeb] = useState<boolean | null>(null);
  const [shots, setShots] = useState<{ file: string; url: string; mtime: string | null }[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkOut, setCheckOut] = useState("");
  const [assets, setAssets] = useState<string[]>([]);
  const [asset, setAsset] = useState("");
  const [msg, setMsg] = useState("");
  const play = `/play/${encodeURIComponent(dir)}/index.html`;
  const loadShots = useCallback(() => studio.shots(dir).then((r) => setShots(r.shots), () => undefined), [dir]);
  useEffect(() => {
    fetch(play, { method: "HEAD" }).then((r) => setWeb(r.ok), () => setWeb(false));
    void loadShots();
    studio.assets(dir).then((r) => {
      setAssets(r.assets);
      setAsset(r.assets[0] ?? "");
    }, () => undefined);
  }, [dir, play, loadShots]);
  const check = async () => {
    setChecking(true);
    setCheckOut("");
    try {
      const r = await studio.check(dir);
      setCheckOut(r.runs.map((x) => `${x.ok ? "ok" : "!!"} ${x.name}${x.skipped ? ` (skipped: ${x.skipped})` : ` ${(x.ms / 1000).toFixed(1)}s`}`).join("\n"));
      await loadShots();
      setNonce(Date.now());
    } catch (e) {
      setCheckOut(fail(e));
    } finally {
      setChecking(false);
    }
  };
  const open = async (app: "godot" | "aseprite", file?: string) => {
    setMsg("");
    try {
      const r = await studio.open(dir, app, file);
      setMsg(`→ ${r.bin}`);
    } catch (e) {
      setMsg(fail(e));
    }
  };
  return (
    <div className="preview">
      <section className="panel play">
        <div className="panel-head">
          <h3>{t("play")}</h3>
          <div className="toolbar">
            <button onClick={() => setNonce(Date.now())}>{t("reload")}</button>
            <a className="button" href={play} target="_blank" rel="noreferrer">
              {t("newTab")} ↗
            </a>
          </div>
        </div>
        {web === false ? <p className="muted">{t("noWeb")}</p> : <div className="frame">{web ? <iframe key={nonce} title="game" src={`${play}?t=${nonce}`} /> : null}</div>}
      </section>
      <div className="col">
        <section className="panel">
          <h3>{t("desktop")}</h3>
          <div className="toolbar">
            <button onClick={() => open("godot")} disabled={!info?.godot}>
              {t("openGodot")}
            </button>
            <span className="small faint mono">{info?.godot ?? `Godot ${t("notFound")} (GODOT_BIN)`}</span>
          </div>
          <div className="toolbar">
            <select value={asset} onChange={(e) => setAsset(e.target.value)} aria-label={t("pickAsset")} className="asset-pick">
              {assets.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <button onClick={() => open("aseprite", asset)} disabled={!info?.aseprite || !asset}>
              {t("openAseprite")}
            </button>
          </div>
          <p className="small faint mono">{info?.aseprite ?? `Aseprite ${t("notFound")} (ASEPRITE_BIN)`}</p>
          {msg ? <p className="small">{msg}</p> : null}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>{t("shots")}</h3>
            <button onClick={check} disabled={checking}>
              {checking ? t("checkingRun") : t("runCheck")}
            </button>
          </div>
          {checkOut ? <pre className="log small">{checkOut}</pre> : null}
          {shots.length === 0 ? <p className="muted small">{t("noShots")}</p> : null}
          <div className="shots">
            {shots.map((s) => (
              <a key={s.file} href={s.url} target="_blank" rel="noreferrer" title={s.file}>
                <img src={`${s.url}?t=${nonce}`} alt={s.file} loading="lazy" />
                <span className="small mono faint">{s.file}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ───────────── ship ───────────── */

function ShipPanel({ dir, manifest, dirty }: { dir: string; manifest: unknown; dirty: boolean }) {
  const { t } = useLang();
  const ship = (manifest as { ship?: { targets: string[]; release?: string } } | null)?.ship;
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; workspace: string; releases: string[]; runs: { id: string; ok: boolean; command: string; output: string }[] } | null>(null);
  const [err, setErr] = useState("");
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      setOut(await studio.ship(dir));
    } catch (e) {
      setErr(fail(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel ship">
      <h3>{t("ship")}</h3>
      <p className="muted">🔒 {t("shipHint")}</p>
      {ship ? (
        <p>
          {t("targets")}: {ship.targets.map((x) => <span key={x} className="chip on">{x}</span>)} {ship.release ? <span className="faint mono">v{ship.release}</span> : null}
        </p>
      ) : (
        <p className="warn">{t("noShip")}</p>
      )}
      <button className="primary big" disabled={busy || !ship || dirty} onClick={run}>
        {busy ? t("shipping") : `📦 ${t("shipNow")}`}
      </button>
      {dirty ? <span className="warn small"> {t("saveFirst")}</span> : null}
      {err ? <p className="warn">{err}</p> : null}
      {out ? (
        <div>
          <p className={out.ok ? "ok" : "warn"}>{out.ok ? "✅ OK" : "❌"} · uploaded: no</p>
          <h4>{t("releases")}</h4>
          <ul className="mono small">
            {out.releases.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="small faint mono">{out.workspace}</p>
          {out.runs.map((r) => (
            <details key={r.id}>
              <summary className={r.ok ? "ok" : "warn"}>
                {r.id} — {r.command}
              </summary>
              <pre className="log small">{r.output}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}
