import Database from "better-sqlite3";
import { getDbPool, initDb } from "../src/db";

async function main() {
  const sqlitePath = process.env.SQLITE_DB_PATH ?? "D:\\highcourt\\highcourt.db";
  const sqlite = new Database(sqlitePath, { readonly: true });
  const pool = getDbPool();

  await initDb();

  console.log(`Importing SQLite data from ${sqlitePath}`);

  await pool.query("TRUNCATE TABLE sync_state, cause_list_snapshots, search_runs, saved_searches RESTART IDENTITY CASCADE");

  const savedSearches = sqlite.prepare("SELECT * FROM saved_searches ORDER BY id ASC").all() as Array<Record<string, unknown>>;
  for (const row of savedSearches) {
    await pool.query(
      `
      INSERT INTO saved_searches
        (id, label, search_type, query_text, filters_json, court_code, status_filter, case_type, case_number, year, notes, created_at, updated_at, last_run_at)
      VALUES
        ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        Number(row.id),
        row.label ? String(row.label) : "",
        row.search_type ? String(row.search_type) : "",
        row.query_text ? String(row.query_text) : null,
        row.filters_json ? String(row.filters_json) : null,
        row.court_code ? String(row.court_code) : null,
        row.status_filter ? String(row.status_filter) : null,
        row.case_type ? String(row.case_type) : null,
        row.case_number ? String(row.case_number) : null,
        row.year ? String(row.year) : null,
        row.notes ? String(row.notes) : null,
        row.created_at ? String(row.created_at) : new Date().toISOString(),
        row.updated_at ? String(row.updated_at) : new Date().toISOString(),
        row.last_run_at ? String(row.last_run_at) : null,
      ],
    );
  }

  const searchRuns = sqlite.prepare("SELECT * FROM search_runs ORDER BY id ASC").all() as Array<Record<string, unknown>>;
  for (const row of searchRuns) {
    await pool.query(
      `
      INSERT INTO search_runs
        (id, saved_search_id, source_type, result_json, created_at)
      VALUES
        ($1, $2, $3, $4::jsonb, $5)
      `,
      [
        Number(row.id),
        Number(row.saved_search_id),
        row.source_type ? String(row.source_type) : "",
        row.result_json ? String(row.result_json) : "{}",
        row.created_at ? String(row.created_at) : new Date().toISOString(),
      ],
    );
  }

  const snapshots = sqlite.prepare("SELECT * FROM cause_list_snapshots ORDER BY id ASC").all() as Array<Record<string, unknown>>;
  for (const row of snapshots) {
    await pool.query(
      `
      INSERT INTO cause_list_snapshots
        (id, source_date, side, list_type, source_url, title, subtitle, content_json, fetched_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `,
      [
        Number(row.id),
        row.source_date ? String(row.source_date) : "",
        row.side ? String(row.side) : "",
        row.list_type ? String(row.list_type) : "",
        row.source_url ? String(row.source_url) : "",
        row.title ? String(row.title) : null,
        row.subtitle ? String(row.subtitle) : null,
        row.content_json ? String(row.content_json) : "{}",
        row.fetched_at ? String(row.fetched_at) : new Date().toISOString(),
      ],
    );
  }

  const syncRows = sqlite.prepare("SELECT * FROM sync_state ORDER BY sync_key ASC").all() as Array<Record<string, unknown>>;
  for (const row of syncRows) {
    await pool.query(
      `
      INSERT INTO sync_state (sync_key, last_run_at, last_status, last_message)
      VALUES ($1, $2, $3, $4)
      `,
      [
        row.sync_key ? String(row.sync_key) : "",
        row.last_run_at ? String(row.last_run_at) : null,
        row.last_status ? String(row.last_status) : null,
        row.last_message ? String(row.last_message) : null,
      ],
    );
  }

  if (savedSearches.length > 0) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('saved_searches', 'id'), (SELECT MAX(id) FROM saved_searches))`);
  }
  if (searchRuns.length > 0) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('search_runs', 'id'), (SELECT MAX(id) FROM search_runs))`);
  }
  if (snapshots.length > 0) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('cause_list_snapshots', 'id'), (SELECT MAX(id) FROM cause_list_snapshots))`);
  }

  sqlite.close();
  await pool.end();

  console.log(`Imported ${savedSearches.length} saved searches, ${searchRuns.length} runs, ${snapshots.length} cause-list snapshots, and ${syncRows.length} sync-state rows.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
