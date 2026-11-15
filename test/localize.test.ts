import { describe, expect, it } from "vitest";
import { localizeDialogue, mergeTables, segmentDialogue } from "../src/lib/localize.js";

const doc: { id: string; lang?: string; characters: { vendor: { name: string } }; nodes: Record<string, { body: any[] }> } = {
  id: "demo",
  characters: { vendor: { name: "ป้าแดง" } },
  nodes: {
    market: {
      body: [
        { t: "line", id: "l1", who: "vendor", text: "สวัสดีจ้ะ" },
        { t: "choice", options: [{ id: "c1", text: "ไปเลย", body: [{ t: "jump", target: "temple" }] }, { id: "c2", text: "ไม่ไป", body: [{ t: "jump", target: "refuse" }] }] },
      ],
    },
    refuse: { body: [{ t: "line", id: "l2", who: "vendor", text: "ไม่เป็นไร" }, { t: "end" }] },
    temple: { body: [{ t: "if", cond: "x", body: [{ t: "jump", target: "farm" }], else: [{ t: "jump", target: "refuse" }] }] },
    farm: { body: [{ t: "end" }] },
  },
};

describe("segmentDialogue", () => {
  it("turns jumps into a later segment into end, keeps jumps inside a segment", () => {
    const { doc: out, cut } = segmentDialogue(doc, ["market", "temple", "farm"]);
    expect(cut).toBe(2);
    const opts = (out.nodes.market.body[1] as any).options;
    expect(opts[0].body[0]).toEqual({ t: "end" });
    expect(opts[1].body[0]).toEqual({ t: "jump", target: "refuse" });
    expect((out.nodes.temple.body[0] as any).body[0]).toEqual({ t: "end" });
    // input untouched
    expect((doc.nodes.market.body[1] as any).options[0].body[0].t).toBe("jump");
  });
});

describe("localizeDialogue", () => {
  const strings = mergeTables([
    { strings: { "dlg.demo.l1": { th: "สวัสดีจ้ะ", en: "Hello dear", ms: "Halo sayang" }, "dlg.demo.c1": { th: "ไปเลย", en: "Let's go" } } },
    { strings: { "dlg.demo.char.vendor": { th: "ป้าแดง", en: "Auntie Daeng", ms: "Mak Cik Daeng" } } },
  ]);

  it("swaps lines, choices and names; falls back to English then Thai and reports misses", () => {
    const ms = localizeDialogue(doc, strings, "ms");
    expect(ms.doc.lang).toBe("ms");
    expect((ms.doc.nodes.market.body[0] as any).text).toBe("Halo sayang");
    expect((ms.doc.nodes.market.body[1] as any).options[0].text).toBe("Let's go");
    expect(ms.doc.characters.vendor.name).toBe("Mak Cik Daeng");
    expect(ms.total).toBe(5);
    expect(ms.translated).toBe(2);
    expect(ms.missing).toEqual(expect.arrayContaining(["dlg.demo.c1", "dlg.demo.c2", "dlg.demo.l2"]));
    expect((ms.doc.nodes.refuse.body[0] as any).text).toBe("ไม่เป็นไร");
  });

  it("keeps Thai source as fully translated", () => {
    const th = localizeDialogue(doc, strings, "th");
    expect(th.translated).toBe(th.total);
    expect(th.missing).toEqual([]);
  });
});
