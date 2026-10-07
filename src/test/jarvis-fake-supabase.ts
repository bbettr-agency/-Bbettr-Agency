/**
 * TEST-ONLY fake of the RLS Supabase query builder for Jarvis read-tool unit tests.
 * Not imported by application code. Supports the narrow chain the Milestone A tools use:
 *   from(table).select(cols,{count,head}).eq/not/is/lt/gt/order/limit(...) → await | maybeSingle()
 * Rows are plain objects; filtering mirrors the operators the tools actually call.
 */

export type FakeRow = Record<string, unknown>;

type Pred =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "notin"; col: string; set: Set<string> }
  | { kind: "isnull"; col: string }
  | { kind: "notnull"; col: string }
  | { kind: "lt"; col: string; val: unknown };

function passes(p: Pred, r: FakeRow): boolean {
  switch (p.kind) {
    case "eq":
      return r[p.col] === p.val;
    case "notin":
      return !p.set.has(String(r[p.col]));
    case "isnull":
      return r[p.col] === null || r[p.col] === undefined;
    case "notnull":
      return r[p.col] !== null && r[p.col] !== undefined;
    case "lt":
      return String(r[p.col]) < String(p.val);
  }
}

class FakeBuilder implements PromiseLike<{ data: FakeRow[] | null; count: number | null; error: null }> {
  private preds: Pred[] = [];
  private wantCount = false;
  private head = false;
  private lim: number | undefined;
  constructor(private rows: FakeRow[]) {}

  select(_cols: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.head = true;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.preds.push({ kind: "eq", col, val });
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    if (op === "in") {
      const set = new Set(String(val).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim()));
      this.preds.push({ kind: "notin", col, set });
    } else if (op === "is" && val === null) {
      this.preds.push({ kind: "notnull", col });
    }
    return this;
  }
  is(col: string, val: unknown): this {
    if (val === null) this.preds.push({ kind: "isnull", col });
    return this;
  }
  lt(col: string, val: unknown): this {
    this.preds.push({ kind: "lt", col, val });
    return this;
  }
  order(): this {
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }
  private filtered(): FakeRow[] {
    return this.rows.filter((r) => this.preds.every((p) => passes(p, r)));
  }
  async maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    return { data: this.filtered()[0] ?? null, error: null };
  }
  then<TResult1 = { data: FakeRow[] | null; count: number | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: FakeRow[] | null; count: number | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const f = this.filtered();
    const count = this.wantCount ? f.length : null;
    const data = this.head ? null : this.lim != null ? f.slice(0, this.lim) : f;
    return Promise.resolve({ data, count, error: null as null }).then(onfulfilled, onrejected);
  }
}

export interface FakeSupabaseOptions {
  /** table name → rows */
  tables?: Record<string, FakeRow[]>;
  /** table names that should throw on access (to exercise failure isolation). */
  throwOn?: string[];
}

export function makeFakeSupabase(opts: FakeSupabaseOptions = {}) {
  const tables = opts.tables ?? {};
  const throwOn = new Set(opts.throwOn ?? []);
  return {
    from(table: string): FakeBuilder {
      if (throwOn.has(table)) throw new Error(`boom:${table}`);
      return new FakeBuilder(tables[table] ?? []);
    },
  };
}
