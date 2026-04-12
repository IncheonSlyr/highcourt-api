import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { config } from "./config";
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

let pool: Pool | null = null;

let initPromise: Promise<void> | null = null;

function mapSavedSearchRow(row: Record<string, unknown>): SavedSearchRecord {
  return {
    id: Number(row.id),
    label: String(row.label),
    searchType: String(row.search_type) as SavedSearchType,
    queryText: row.query_text ? String(row.query_text) : null,
    filtersJson: row.filters_json ? (row.filters_json as Record<string, unknown>) : null,
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
    resultJson: row.result_json,
    createdAt: String(row.created_at),
  };
}

export function getDbPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL or POSTGRES_URL must be set.");
    }

    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes("localhost")
        ? undefined
        : {
            rejectUnauthorized: false,
          },
    });

    attachDatabasePool(pool);
  }

  return pool;
}

export async function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      const pool = getDbPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS saved_searches (
          id BIGSERIAL PRIMARY KEY,
          label TEXT NOT NULL,
          search_type TEXT NOT NULL,
          query_text TEXT,
          filters_json JSONB,
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
          id BIGSERIAL PRIMARY KEY,
          saved_search_id BIGINT NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
          source_type TEXT NOT NULL,
          result_json JSONB NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cause_list_snapshots (
          id BIGSERIAL PRIMARY KEY,
          source_date TEXT NOT NULL,
          side TEXT NOT NULL,
          list_type TEXT NOT NULL,
          source_url TEXT NOT NULL,
          title TEXT,
          subtitle TEXT,
          content_json JSONB NOT NULL,
          fetched_at TEXT NOT NULL,
          UNIQUE(source_date, side, list_type)
        );

        CREATE TABLE IF NOT EXISTS sync_state (
          sync_key TEXT PRIMARY KEY,
          last_run_at TEXT,
          last_status TEXT,
          last_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_saved_searches_updated_at ON saved_searches(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_search_runs_saved_search_id_created_at ON search_runs(saved_search_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cause_list_snapshots_source_date ON cause_list_snapshots(source_date);
      `);
    })();
  }

  return initPromise;
}

export const savedSearchDb = {
  async list() {
    const pool = getDbPool();
    const { rows } = await pool.query(
      `
      SELECT s.*,
             r.id AS latest_run_id,
             r.source_type AS latest_run_source_type,
             r.result_json AS latest_run_result_json,
             r.created_at AS latest_run_created_at
      FROM saved_searches s
      LEFT JOIN LATERAL (
        SELECT id, source_type, result_json, created_at
        FROM search_runs
        WHERE saved_search_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) r ON TRUE
      ORDER BY s.updated_at DESC
      `,
    );

    return rows.map((row) => ({
      ...mapSavedSearchRow(row),
      latestRun: row.latest_run_id
        ? mapRunRow({
            id: row.latest_run_id,
            source_type: row.latest_run_source_type,
            result_json: row.latest_run_result_json,
            created_at: row.latest_run_created_at,
          })
        : null,
    })) satisfies SavedSearchListItem[];
  },

  async get(id: number) {
    const pool = getDbPool();
    const { rows } = await pool.query("SELECT * FROM saved_searches WHERE id = $1", [id]);
    return rows[0] ? mapSavedSearchRow(rows[0]) : null;
  },

  async getWithLatestRun(id: number) {
    const record = await this.get(id);
    if (!record) {
      return null;
    }

    return {
      ...record,
      latestRun: await this.getLatestRun(id),
    } satisfies SavedSearchListItem;
  },

  async create(input: Omit<SavedSearchRecord, "id" | "createdAt" | "updatedAt" | "lastRunAt">) {
    const pool = getDbPool();
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `
      INSERT INTO saved_searches
        (label, search_type, query_text, filters_json, court_code, status_filter, case_type, case_number, year, notes, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
      `,
      [
        input.label,
        input.searchType,
        input.queryText,
        input.filtersJson,
        input.courtCode,
        input.statusFilter,
        input.caseType,
        input.caseNumber,
        input.year,
        input.notes,
        now,
        now,
      ],
    );

    return rows[0] ? mapSavedSearchRow(rows[0]) : null;
  },

  async update(id: number, patch: Partial<Omit<SavedSearchRecord, "id" | "createdAt" | "updatedAt" | "lastRunAt">>) {
    const pool = getDbPool();
    const current = await this.get(id);
    if (!current) {
      return null;
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    const { rows } = await pool.query(
      `
      UPDATE saved_searches
      SET label = $1,
          search_type = $2,
          query_text = $3,
          filters_json = $4,
          court_code = $5,
          status_filter = $6,
          case_type = $7,
          case_number = $8,
          year = $9,
          notes = $10,
          updated_at = $11
      WHERE id = $12
      RETURNING *
      `,
      [
        next.label,
        next.searchType,
        next.queryText,
        next.filtersJson,
        next.courtCode,
        next.statusFilter,
        next.caseType,
        next.caseNumber,
        next.year,
        next.notes,
        next.updatedAt,
        id,
      ],
    );

    return rows[0] ? mapSavedSearchRow(rows[0]) : null;
  },

  async delete(id: number) {
    const pool = getDbPool();
    const result = await pool.query("DELETE FROM saved_searches WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  },

  async addRun(savedSearchId: number, sourceType: string, resultJson: unknown) {
    const pool = getDbPool();
    const now = new Date().toISOString();
    await pool.query(
      `
      INSERT INTO search_runs (saved_search_id, source_type, result_json, created_at)
      VALUES ($1, $2, $3, $4)
      `,
      [savedSearchId, sourceType, resultJson, now],
    );
    await pool.query(
      "UPDATE saved_searches SET last_run_at = $1, updated_at = $1 WHERE id = $2",
      [now, savedSearchId],
    );
  },

  async listRuns(savedSearchId: number) {
    const pool = getDbPool();
    const { rows } = await pool.query(
      `
      SELECT id, source_type, result_json, created_at
      FROM search_runs
      WHERE saved_search_id = $1
      ORDER BY created_at DESC
      `,
      [savedSearchId],
    );
    return rows.map(mapRunRow);
  },

  async getLatestRun(savedSearchId: number) {
    const pool = getDbPool();
    const { rows } = await pool.query(
      `
      SELECT id, source_type, result_json, created_at
      FROM search_runs
      WHERE saved_search_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [savedSearchId],
    );
    return rows[0] ? mapRunRow(rows[0]) : null;
  },
};

export const causeListCacheDb = {
  async upsertSnapshot(input: {
    sourceDate: string;
    side: string;
    listType: string;
    sourceUrl: string;
    title: string | null;
    subtitle: string | null;
    contentJson: unknown;
  }) {
    const pool = getDbPool();
    const fetchedAt = new Date().toISOString();
    await pool.query(
      `
      INSERT INTO cause_list_snapshots
        (source_date, side, list_type, source_url, title, subtitle, content_json, fetched_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (source_date, side, list_type)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        content_json = EXCLUDED.content_json,
        fetched_at = EXCLUDED.fetched_at
      `,
      [input.sourceDate, input.side, input.listType, input.sourceUrl, input.title, input.subtitle, input.contentJson, fetchedAt],
    );
  },

  async search(params: {
    query: string;
    startDate: string;
    endDate: string;
    sides?: string[];
    listTypes?: string[];
  }) {
    const pool = getDbPool();
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

    const { rows } = await pool.query(
      `
      SELECT source_date, side, list_type, source_url, title, subtitle, content_json, fetched_at
      FROM cause_list_snapshots
      WHERE source_date >= $1 AND source_date <= $2
      ORDER BY source_date ASC, side ASC, list_type ASC
      `,
      [params.startDate, params.endDate],
    );

    return rows
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
        const parsed = row.content_json as { entries?: Array<Record<string, unknown>> };
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
  },

  async listRecent(limit = 30) {
    const pool = getDbPool();
    const { rows } = await pool.query(
      `
      SELECT source_date, side, list_type, source_url, title, subtitle, fetched_at
      FROM cause_list_snapshots
      ORDER BY fetched_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return rows;
  },

  async countSnapshots(params: {
    startDate: string;
    endDate: string;
    sides?: string[];
    listTypes?: string[];
  }) {
    const pool = getDbPool();
    const { rows } = await pool.query(
      `
      SELECT source_date, side, list_type
      FROM cause_list_snapshots
      WHERE source_date >= $1 AND source_date <= $2
      `,
      [params.startDate, params.endDate],
    );

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
  async set(syncKey: string, status: string, message: string) {
    const pool = getDbPool();
    const lastRunAt = new Date().toISOString();
    await pool.query(
      `
      INSERT INTO sync_state (sync_key, last_run_at, last_status, last_message)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (sync_key)
      DO UPDATE SET
        last_run_at = EXCLUDED.last_run_at,
        last_status = EXCLUDED.last_status,
        last_message = EXCLUDED.last_message
      `,
      [syncKey, lastRunAt, status, message],
    );
  },

  async get(syncKey: string) {
    const pool = getDbPool();
    const { rows } = await pool.query("SELECT * FROM sync_state WHERE sync_key = $1", [syncKey]);
    return rows[0] ?? null;
  },
};
