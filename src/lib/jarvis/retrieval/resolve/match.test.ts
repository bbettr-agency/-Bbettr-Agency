import { describe, it, expect } from "vitest";
import { resolveClientFromList, type ClientLike } from "./match";
import { normalizeName } from "./normalize";

const CLIENTS: ClientLike[] = [
  { id: "a1", name: "A&S Wholesalers" },
  { id: "f1", name: "Fine Art Printers" },
  { id: "s1", name: "Smile Connection" },
  { id: "c1", name: "Cuisine Foods" },
  { id: "z1", name: "Northgate Retail", company: "Zephyr Logistics" },
];

const one = (r: ReturnType<typeof resolveClientFromList>) => (r.status === "one" ? r.entity : null);

describe("normalizeName", () => {
  it("unifies & / and / spacing / case / punctuation and strips legal suffixes", () => {
    expect(normalizeName("A&S Wholesalers")).toBe("a and s wholesalers");
    expect(normalizeName("A & S Wholesalers")).toBe("a and s wholesalers");
    expect(normalizeName("A and S Wholesalers")).toBe("a and s wholesalers");
    expect(normalizeName("Fine Art Printers (Pty) Ltd")).toBe("fine art printers");
    expect(normalizeName("  Café  Noir ")).toBe("cafe noir");
  });
});

describe("resolveClientFromList — required resolution cases", () => {
  it("A&S Wholesalers → resolves exactly", () => {
    expect(one(resolveClientFromList("What is happening with A&S Wholesalers?", CLIENTS))?.id).toBe("a1");
  });
  it("A&S → resolves to A&S Wholesalers (prefix)", () => {
    expect(one(resolveClientFromList("What is happening with A&S?", CLIENTS))?.id).toBe("a1");
  });
  it("A and S → resolves to A&S Wholesalers", () => {
    expect(one(resolveClientFromList("hows A and S doing", CLIENTS))?.id).toBe("a1");
  });
  it("Fine Art → resolves to Fine Art Printers (prefix)", () => {
    const e = one(resolveClientFromList("Tell me everything on Fine Art", CLIENTS));
    expect(e?.id).toBe("f1");
    expect(e?.tier).toBe("prefix");
  });
  it("Smile Connection → resolves exactly", () => {
    expect(one(resolveClientFromList("what's up with Smile Connection", CLIENTS))?.id).toBe("s1");
  });
  it("company-only match resolves via the company field", () => {
    const e = one(resolveClientFromList("how is Zephyr Logistics doing", CLIENTS));
    expect(e?.id).toBe("z1");
    expect(e?.matchedOn).toBe("company");
  });
});

describe("resolveClientFromList — ambiguity & safety", () => {
  it("ambiguous phrase → many (clarify), never auto-picks the first candidate", () => {
    const list: ClientLike[] = [
      { id: "fa1", name: "Fine Art Printers" },
      { id: "fa2", name: "Fine Art Studio" },
    ];
    const r = resolveClientFromList("what is happening with Fine Art", list);
    expect(r.status).toBe("many");
    if (r.status === "many") {
      expect(r.candidates.map((c) => c.id).sort()).toEqual(["fa1", "fa2"]);
    }
  });
  it("nonexistent client → unresolved (none), never invented", () => {
    expect(resolveClientFromList("what about Globex Corporation?", CLIENTS).status).toBe("none");
  });
  it("nested names: full reference wins, short reference resolves to the short client", () => {
    const list: ClientLike[] = [
      { id: "short", name: "A&S" },
      { id: "long", name: "A&S Wholesalers" },
    ];
    expect(one(resolveClientFromList("A&S Wholesalers please", list))?.id).toBe("long");
    expect(one(resolveClientFromList("just A&S", list))?.id).toBe("short");
  });
  it("generic short token does not fire ('art' alone)", () => {
    expect(resolveClientFromList("i like art", CLIENTS).status).toBe("none");
  });
  it("a raw DB id in the message resolves nothing (ids are never model-supplied)", () => {
    // The id of Fine Art Printers appears verbatim, but resolution is by NAME only.
    expect(resolveClientFromList("tell me about f1 and a1", CLIENTS).status).toBe("none");
  });
  it("resolution ids come only from the authorized list", () => {
    const r = resolveClientFromList("A&S Wholesalers", CLIENTS);
    if (r.status === "one") expect(CLIENTS.some((c) => c.id === r.entity.id)).toBe(true);
  });
});
