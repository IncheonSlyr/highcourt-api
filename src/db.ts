import Database from "better-sqlite3";
import type { SavedSearchType } from "./types";

export type SavedSearchRecord = {
  id: number;
  label: string;
  searchType: SavedSearchType;
  queryText: string | null;
  filtersJson: Record<string, unknown> | null;
  courtCode: string | null;
  statusFilter: string | null;
  caseType: string | null;
  caseNumber: string | null;
  year: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

export type SearchRunRecord = {
  id: number;
  sourceType: string;
  resultJson: unknown;
  createdAt: string;
};

export type SavedSearchListItem = SavedSearchRecord & {
  latestRun: SearchRunRecord | null;
};

const db = new Database("D:\\highcourt\\highcourt.db");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

function ensureColumn(tableName: string, columnName: string, columnDefinition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    search_type TEXT NOT NULL,
    query_text TEXT,
    filters_json TEXT,
    court_code TEXT,
    status_filter TEXT,
    case_type TEXT,
    case_number TEXT,
    year TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_run_at TEXT
  );

  CREATE TABLE IF NOT EXISTS search_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_search_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(saved_search_id) REFERENCES saved_searches(id)
  );

  CREATE TABLE IF NOT EXISTS cause_list_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_date TEXT NOT NULL,
    side TEXT NOT NULL,
    list_type TEXT NOT NULL,
    source_url TEXT NOT NULL,
    title TEXT,
    subtitle TEXT,
    content_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    UNIQUE(source_date, side, list_type)
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    sync_key TEXT PRIMARY KEY,
    last_run_at TEXT,
    last_status TEXT,
    last_message TEXT
  );
`);

ensureColumn("saved_searches", "filters_json", "TEXT");

function mapRow(row: Record<string, unknown>): SavedSearchRecord {
  return {
    id: Number(row.id),
    label: String(row.label),
    searchType: row.search_type as SavedSearchType,
    queryText: row.query_text ? String(row.query_text) : null,
    filtersJson: row.filters_json ? (JSON.parse(String(row.filters_json)) as Record<string, unknown>) : null,
    courtCode: row.court_code ? String(row.court_code) : null,
    statusFilter: row.status_filter ? String(row.status_filter) : null,
    caseType: row.case_type ? String(row.case_type) : null,
    caseNumber: row.case_number ? String(row.case_number) : null,
    year: row.year ? String(row.year) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
  };
}

function mapRunRow(row: Record<string, unknown>): SearchRunRecord {
  return {
    id: Number(row.id),
    sourceType: String(row.source_type),
    resultJson: JSON.parse(String(row.result_json)),
    createdAt: String(row.created_at),
  };
}

export const savedSearchDb = {
  list() {
    const rows = db.prepare("SELECT * FROM saved_searches ORDER BY updated_at DESC").all() as Record<string, unknown>[];
    return rows.map((row) => {
      const savedSearch = mapRow(row);
      return {
        ...savedSearch,
        latestRun: this.getLatestRun(savedSearch.id),
      } satisfies SavedSearchListItem;
    });
  },

  get(id: number) {
    const row = db.prepare("SELECT * FROM saved_searches WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  },

  getWithLatestRun(id: number) {
    const record = this.get(id);
    if (!record) {
      return null;
    }

    return {
      ...record,
      latestRun: this.getLatestRun(id),
    } satisfies SavedSearchListItem;
  },

  create(input: Omit<SavedSearchRecord, "id" | "createdAt" | "updatedAt" | "lastRunAt">) {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `
        INSERT INTO saved_searches
          (label, search_type, query_text, filters_json, court_code, status_filter, case_type, case_number, year, notes, created_at, updated_at)
        VALUES
          (@label, @searchType, @queryText, @filtersJson, @courtCode, @statusFilter, @caseType, @caseNumber, @year, @notes, @createdAt, @updatedAt)
      `,
      )
      .run({
        ...input,
        filtersJson: input.filtersJson ? JSON.stringify(input.filtersJson) : null,
        createdAt: now,
        updatedAt: now,
      });

    return this.get(Number(result.lastInsertRowid));
  },

  update(id: number, patch: Partial<Omit<SavedSearchRecord, "id" | "createdAt" | "updatedAt" | "lastRunAt">>) {
    const current = this.get(id);
    if (!current) {
      return null;
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    db.prepare(
      `
      UPDATE saved_searches
      SET label = @label,
          search_type = @searchType,
          query_text = @queryText,
          filters_json = @filtersJson,
          court_code = @courtCode,
          status_filter = @statusFilter,
          case_type = @caseType,
          case_number = @caseNumber,
          year = @year,
          notes = @notes,
          updated_at = @updatedAt
      WHERE id = @id
    `,
    ).run({
      ...next,
      filtersJson: next.filtersJson ? JSON.stringify(next.filtersJson) : null,
      id,
    });

    return this.get(id);
  },

  delete(id: number) {
    db.prepare("DELETE FROM search_runs WHERE saved_search_id = ?").run(id);
    const result = db.prepare("DELETE FROM saved_searches WHERE id = ?").run(id);
    return result.changes > 0;
  },

  addRun(savedSearchId: number, sourceType: string, resultJson: unknown) {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO search_runs (saved_search_id, source_type, result_json, created_at)
      VALUES (?, ?, ?, ?)
    `,
    ).run(savedSearchId, sourceType, JSON.stringify(resultJson), now);
    db.prepare("UPDATE saved_searches SET last_run_at = ?, updated_at = ? WHERE id = ?").run(now, now, savedSearchId);
  },

  listRuns(savedSearchId: number) {
    const rows = db
      .prepare("SELECT id, source_type, result_json, created_at FROM search_runs WHERE saved_search_id = ? ORDER BY created_at DESC")
      .all(savedSearchId) as Array<Record<string, unknown>>;
    return rows.map(mapRunRow);
  },

  getLatestRun(savedSearchId: number) {
    const row = db
      .prepare(
        "SELECT id, source_type, result_json, created_at FROM search_runs WHERE saved_search_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(savedSearchId) as Record<string, unknown> | undefined;
    return row ? mapRunRow(row) : null;
  },
};

export const causeListCacheDb = {
  upsertSnapshot(input: {
    sourceDate: string;
    side: string;
    listType: string;
    sourceUrl: string;
    title: string | null;
    subtitle: string | null;
    contentJson: unknown;
  }) {
    const fetchedAt = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO cause_list_snapshots
        (source_date, side, list_type, source_url, title, subtitle, content_json, fetched_at)
      VALUES
        (@sourceDate, @side, @listType, @sourceUrl, @title, @subtitle, @contentJson, @fetchedAt)
      ON CONFLICT(source_date, side, list_type)
      DO UPDATE SET
        source_url = excluded.source_url,
        title = excluded.title,
        subtitle = excluded.subtitle,
        content_json = excluded.content_json,
        fetched_at = excluded.fetched_at
    `,
    ).run({
      ...input,
      contentJson: JSON.stringify(input.contentJson),
      fetchedAt,
    });
  },

  search(params: {
    query: string;
    startDate: string;
    endDate: string;
    sides?: string[];
    listTypes?: string[];
  }) {
    const normalizeSearchText = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9/ ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const matchesQuery = (haystack: string, query: string) => {
      const normalizedHaystack = normalizeSearchText(haystack);
      const normalizedQuery = normalizeSearchText(query);
      if (!normalizedQuery) {
        return false;
      }

      if (normalizedHaystack.includes(normalizedQuery)) {
        return true;
      }

      const tokens = normalizedQuery.split(" ").filter(Boolean);
      return tokens.every((token) => normalizedHaystack.includes(token));
    };

    const rows = db
      .prepare(
        `
        SELECT source_date, side, list_type, source_url, title, subtitle, content_json, fetched_at
        FROM cause_list_snapshots
        WHERE source_date >= ? AND source_date <= ?
        ORDER BY source_date ASC, side ASC, list_type ASC
      `,
      )
      .all(params.startDate, params.endDate) as Array<Record<string, unknown>>;

    const results = rows
      .filter((row) => {
        if (params.sides?.length && !params.sides.includes(String(row.side))) {
          return false;
        }
        if (params.listTypes?.length && !params.listTypes.includes(String(row.list_type))) {
          return false;
        }
        return true;
      })
      .map((row) => {
        const parsed = JSON.parse(String(row.content_json)) as { entries?: Array<Record<string, unknown>> };
        const matches = (parsed.entries ?? []).filter((entry) => matchesQuery(JSON.stringify(entry), params.query));

        return {
          date: String(row.source_date),
          side: String(row.side),
          listType: String(row.list_type),
          sourceUrl: String(row.source_url),
          title: row.title ? String(row.title) : null,
          subtitle: row.subtitle ? String(row.subtitle) : null,
          fetchedAt: String(row.fetched_at),
          matchCount: matches.length,
          matches,
        };
      })
      .filter((item) => item.matchCount > 0);

    return results;
  },

  listRecent(limit = 30) {
    return db
      .prepare(
        `
        SELECT source_date, side, list_type, source_url, title, subtitle, fetched_at
        FROM cause_list_snapshots
        ORDER BY fetched_at DESC
        LIMIT ?
      `,
      )
      .all(limit);
  },

  countSnapshots(params: {
    startDate: string;
    endDate: string;
    sides?: string[];
    listTypes?: string[];
  }) {
    const rows = db
      .prepare(
        `
        SELECT source_date, side, list_type
        FROM cause_list_snapshots
        WHERE source_date >= ? AND source_date <= ?
      `,
      )
      .all(params.startDate, params.endDate) as Array<Record<string, unknown>>;

    return rows.filter((row) => {
      if (params.sides?.length && !params.sides.includes(String(row.side))) {
        return false;
      }
      if (params.listTypes?.length && !params.listTypes.includes(String(row.list_type))) {
        return false;
      }
      return true;
    }).length;
  },
};

export const syncStateDb = {
  set(syncKey: string, status: string, message: string) {
    const lastRunAt = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO sync_state (sync_key, last_run_at, last_status, last_message)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sync_key)
      DO UPDATE SET
        last_run_at = excluded.last_run_at,
        last_status = excluded.last_status,
        last_message = excluded.last_message
    `,
    ).run(syncKey, lastRunAt, status, message);
  },

  get(syncKey: string) {
    return db.prepare("SELECT * FROM sync_state WHERE sync_key = ?").get(syncKey);
  },
};
