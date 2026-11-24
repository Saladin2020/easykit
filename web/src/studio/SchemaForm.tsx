import { useState } from "react";
import type { JsonSchema } from "./api";
import { useLang } from "./i18n";

export type Path = (string | number)[];
export const fieldId = (p: Path) => `f-${p.join(".")}`;

/** "battle.enemies[4]" / "quests.main:20" → ["battle","enemies","4"]. */
export function issuePath(p: string): string[] {
  return p
    .replace(/:.*$/, "")
    .split(/[.[\]]+/)
    .filter(Boolean);
}

export function setIn(obj: unknown, path: Path, value: unknown): unknown {
  if (!path.length) return value;
  const [k, ...rest] = path;
  if (Array.isArray(obj)) {
    const next = obj.slice();
    if (rest.length === 0 && value === undefined) next.splice(Number(k), 1);
    else next[Number(k)] = setIn(next[Number(k)], rest, value);
    return next;
  }
  const o = { ...((obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>) };
  if (rest.length === 0 && value === undefined) delete o[String(k)];
  else o[String(k)] = setIn(o[String(k)], rest, value);
  return o;
}

export function defaultFor(s: JsonSchema): unknown {
  if (s.default !== undefined) return structuredClone(s.default);
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.prefixItems) return s.prefixItems.map(defaultFor);
  switch (s.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return s.minimum ?? 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return Object.fromEntries((s.required ?? []).filter((k) => s.properties?.[k]).map((k) => [k, defaultFor(s.properties![k]!)]));
    default:
      return null;
  }
}

const isSimple = (s: JsonSchema) => !!s.enum || s.const !== undefined || ["string", "number", "integer", "boolean"].includes(s.type ?? "") || !!s.prefixItems;
const human = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");

interface Ctx {
  onChange: (p: Path, v: unknown) => void;
  bad: Set<string>;
}

function Scalar({ s, value, path, ctx, required }: { s: JsonSchema; value: unknown; path: Path; ctx: Ctx; required: boolean }) {
  const set = (v: unknown) => ctx.onChange(path, v);
  const label = String(path[path.length - 1]);
  if (s.const !== undefined) return <input aria-label={label} value={String(value ?? s.const)} readOnly className="readonly" />;
  if (s.enum)
    return (
      <select aria-label={label} value={value === undefined ? "" : String(value)} onChange={(e) => set(e.target.value === "" ? undefined : typeof s.enum![0] === "number" ? Number(e.target.value) : e.target.value)}>
        {!required || value === undefined ? <option value="">—</option> : null}
        {s.enum.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  if (s.type === "boolean") return <input aria-label={label} type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} />;
  if (s.type === "number" || s.type === "integer")
    return (
      <input
        aria-label={label}
        type="number"
        step={s.type === "integer" ? 1 : "any"}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  if (s.prefixItems) {
    const arr = Array.isArray(value) ? value : [];
    return (
      <span className="tuple">
        {s.prefixItems.map((it, i) => (
          <Scalar key={i} s={it} value={arr[i]} path={[...path, i]} ctx={ctx} required />
        ))}
      </span>
    );
  }
  const str = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  return <input aria-label={label} value={str} onChange={(e) => set(e.target.value)} lang={/[\u0E00-\u0E7F]/.test(str) ? "th" : undefined} spellCheck={false} />;
}

/** One property: label + editor, with add/remove for optional values. */
function Field({ name, s, value, path, ctx, required, label }: { name: string; s: JsonSchema; value: unknown; path: Path; ctx: Ctx; required: boolean; label?: string }) {
  const { t } = useLang();
  const key = path.join(".");
  const cls = `field${isSimple(s) ? " simple" : " complex"}${ctx.bad.has(key) ? " has-issue" : ""}`;
  const head = (
    <span className="field-label">
      {label ?? human(name)}
      {required ? <i className="req">*</i> : null}
      {!required && value !== undefined ? (
        <button className="mini ghost" title={t("remove")} onClick={() => ctx.onChange(path, undefined)}>
          ×
        </button>
      ) : null}
    </span>
  );
  if (value === undefined && !required)
    return (
      <div className={`${cls} absent`} id={fieldId(path)}>
        {head}
        <button className="mini" onClick={() => ctx.onChange(path, defaultFor(s))}>
          {t("addField")}
        </button>
      </div>
    );
  if (isSimple(s))
    return (
      <label className={cls} id={fieldId(path)}>
        {head}
        <Scalar s={s} value={value} path={path} ctx={ctx} required={required} />
      </label>
    );
  return (
    <fieldset className={cls} id={fieldId(path)}>
      <legend>{head}</legend>
      <Node s={s} value={value} path={path} ctx={ctx} />
    </fieldset>
  );
}

function RecordEditor({ s, value, path, ctx }: { s: JsonSchema; value: Record<string, unknown>; path: Path; ctx: Ctx }) {
  const { t } = useLang();
  const [nk, setNk] = useState("");
  const item = (typeof s.additionalProperties === "object" ? s.additionalProperties : {}) as JsonSchema;
  return (
    <div className="record">
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className={`item${ctx.bad.has([...path, k].join(".")) ? " has-issue" : ""}`} id={fieldId([...path, k])}>
          <div className="item-head">
            <code>{k}</code>
            <button className="mini ghost" onClick={() => ctx.onChange([...path, k], undefined)}>
              {t("remove")}
            </button>
          </div>
          {isSimple(item) ? <Scalar s={item} value={v} path={[...path, k]} ctx={ctx} required /> : <Node s={item} value={v} path={[...path, k]} ctx={ctx} />}
        </div>
      ))}
      <div className="add-row">
        <input placeholder={t("key")} value={nk} onChange={(e) => setNk(e.target.value.trim())} spellCheck={false} />
        <button
          className="mini"
          disabled={!nk || nk in value}
          onClick={() => {
            ctx.onChange([...path, nk], defaultFor(item));
            setNk("");
          }}
        >
          {t("add")}
        </button>
      </div>
    </div>
  );
}

function ArrayEditor({ s, value, path, ctx }: { s: JsonSchema; value: unknown[]; path: Path; ctx: Ctx }) {
  const { t } = useLang();
  const item = (s.items || {}) as JsonSchema;
  // array of enum strings → toggle chips
  if (item.enum && item.type === "string") {
    return (
      <div className="chips">
        {item.enum.map((o) => {
          const on = value.includes(o);
          return (
            <button key={String(o)} className={`chip${on ? " on" : ""}`} onClick={() => ctx.onChange(path, on ? value.filter((x) => x !== o) : [...value, o])}>
              {String(o)}
            </button>
          );
        })}
      </div>
    );
  }
  const simple = isSimple(item);
  return (
    <div className={simple ? "list simple-list" : "list"}>
      {value.map((v, i) => (
        <div key={i} className={`item${ctx.bad.has([...path, i].join(".")) ? " has-issue" : ""}`} id={fieldId([...path, i])}>
          {simple ? (
            <>
              <Scalar s={item} value={v} path={[...path, i]} ctx={ctx} required />
              <button className="mini ghost" title={t("remove")} onClick={() => ctx.onChange([...path, i], undefined)}>
                ×
              </button>
            </>
          ) : (
            <>
              <div className="item-head">
                <code>
                  #{i + 1}
                  {v && typeof v === "object" && "id" in v ? ` · ${String((v as { id: unknown }).id)}` : ""}
                </code>
                <button className="mini ghost" onClick={() => ctx.onChange([...path, i], undefined)}>
                  {t("remove")}
                </button>
              </div>
              <Node s={item} value={v} path={[...path, i]} ctx={ctx} />
            </>
          )}
        </div>
      ))}
      <button className="mini add" disabled={s.maxItems !== undefined && value.length >= s.maxItems} onClick={() => ctx.onChange([...path, value.length], defaultFor(item))}>
        {t("add")}
      </button>
    </div>
  );
}

/** Editor for any schema node. */
export function Node({ s, value, path, ctx }: { s: JsonSchema; value: unknown; path: Path; ctx: Ctx }) {
  if (s.type === "array" && !s.prefixItems) return <ArrayEditor s={s} value={Array.isArray(value) ? value : []} path={path} ctx={ctx} />;
  if (s.type === "object" && s.properties) {
    const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const req = new Set(s.required ?? []);
    const keys = Object.keys(s.properties);
    const simple = keys.filter((k) => isSimple(s.properties![k]!));
    const complex = keys.filter((k) => !isSimple(s.properties![k]!));
    return (
      <div className="obj">
        {simple.length ? (
          <div className="grid">
            {simple.map((k) => (
              <Field key={k} name={k} s={s.properties![k]!} value={o[k]} path={[...path, k]} ctx={ctx} required={req.has(k)} />
            ))}
          </div>
        ) : null}
        {complex.map((k) => (
          <Field key={k} name={k} s={s.properties![k]!} value={o[k]} path={[...path, k]} ctx={ctx} required={req.has(k)} />
        ))}
      </div>
    );
  }
  if (s.type === "object" && s.additionalProperties) return <RecordEditor s={s} value={(value && typeof value === "object" ? value : {}) as Record<string, unknown>} path={path} ctx={ctx} />;
  if (isSimple(s)) return <Scalar s={s} value={value} path={path} ctx={ctx} required />;
  return <pre className="mono small">{JSON.stringify(value, null, 2)}</pre>;
}

/** A whole manifest section (top-level property). */
export function SectionForm({ section, schema, value, onChange, bad, required, title }: { section: string; schema: JsonSchema; value: unknown; onChange: (p: Path, v: unknown) => void; bad: Set<string>; required: boolean; title: string }) {
  const ctx = { onChange, bad };
  return (
    <div className="section-form" id={fieldId([section])}>
      <Field name={section} label={title} s={schema} value={value} path={[section]} ctx={ctx} required={required} />
    </div>
  );
}
