import initSqlJs from "sql.js";
import type { Database as RawDatabase, SqlJsStatic, SqlValue } from "sql.js";

type Row = Record<string, unknown>;

export interface SqlJsOptions {
  /** Resolves the sql-wasm.wasm URL in a browser or WebView. Node needs nothing. */
  locateFile?: (file: string) => string;
}

function isNamed(param: unknown): param is Record<string, unknown> {
  return (
    typeof param === "object" &&
    param !== null &&
    !Array.isArray(param) &&
    !(param instanceof Uint8Array)
  );
}

function toValue(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  return v as SqlValue;
}

function bindArgs(params: unknown[]): SqlValue[] | Record<string, SqlValue> {
  if (params.length === 1 && isNamed(params[0])) {
    const out: Record<string, SqlValue> = {};
    for (const [key, value] of Object.entries(params[0])) {
      out[`@${key}`] = toValue(value);
    }
    return out;
  }
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map(toValue);
}

type RawStatement = ReturnType<RawDatabase["prepare"]>;

export class SqlJsStatement {
  constructor(
    private readonly owner: SqlJsDatabase,
    private readonly sql: string
  ) {}

  get(...params: unknown[]): Row | undefined {
    return this.owner.withStatement(this.sql, params, (stmt) =>
      stmt.step() ? (stmt.getAsObject() as Row) : undefined
    );
  }

  all(...params: unknown[]): Row[] {
    return this.owner.withStatement(this.sql, params, (stmt) => {
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    });
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    this.owner.withStatement(this.sql, params, (stmt) => {
      stmt.step();
    });
    return this.owner.lastRunInfo();
  }
}

export class SqlJsDatabase {
  private depth = 0;

  constructor(private readonly raw: RawDatabase) {
    this.raw.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql: string): SqlJsStatement {
    return new SqlJsStatement(this, sql);
  }

  /** @internal Prepares, binds and frees one statement around fn. */
  withStatement<T>(
    sql: string,
    params: unknown[],
    fn: (stmt: RawStatement) => T
  ): T {
    const stmt = this.raw.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(bindArgs(params) as never);
      return fn(stmt);
    } finally {
      stmt.free();
    }
  }

  /** @internal */
  lastRunInfo(): { changes: number; lastInsertRowid: number } {
    const res = this.raw.exec("SELECT last_insert_rowid()");
    const id = res[0]?.values[0]?.[0];
    return {
      changes: this.raw.getRowsModified(),
      lastInsertRowid: typeof id === "number" ? id : 0,
    };
  }

  transaction<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
    return (...args: A): R => {
      const nested = this.depth > 0;
      const savepoint = `sp_${this.depth}`;
      this.raw.run(nested ? `SAVEPOINT ${savepoint}` : "BEGIN");
      this.depth++;
      try {
        const result = fn(...args);
        this.raw.run(nested ? `RELEASE ${savepoint}` : "COMMIT");
        return result;
      } catch (err) {
        // A failed COMMIT (e.g. deferred FK violation) leaves the transaction
        // open, so roll back here. Never let a rollback error mask the original.
        try {
          if (nested) {
            this.raw.run(`ROLLBACK TO ${savepoint}`);
            this.raw.run(`RELEASE ${savepoint}`);
          } else {
            this.raw.run("ROLLBACK");
          }
        } catch {
          // Nothing left to roll back.
        }
        throw err;
      } finally {
        this.depth--;
      }
    };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  pragma(source: string): unknown[] {
    return this.withStatement(`PRAGMA ${source}`, [], (stmt) => {
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Row);
      return rows;
    });
  }

  export(): Uint8Array {
    // sql.js resets connection state on export, so restore the foreign key pragma.
    const bytes = this.raw.export();
    this.raw.exec("PRAGMA foreign_keys = ON");
    return bytes;
  }

  close(): void {
    this.raw.close();
  }
}

let sqlPromise: Promise<SqlJsStatic> | undefined;

export async function createSqlJsDatabase(
  bytes: Uint8Array,
  options: SqlJsOptions = {}
): Promise<SqlJsDatabase> {
  sqlPromise ??= initSqlJs(
    options.locateFile ? { locateFile: options.locateFile } : undefined
  );
  const SQL = await sqlPromise;
  return new SqlJsDatabase(new SQL.Database(bytes));
}
