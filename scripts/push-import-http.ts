import "dotenv/config";
import Database from "better-sqlite3";

function readSqlite(sqlitePath: string) {
  const sqlite = new Database(sqlitePath, { readonly: true });
  const savedSearches = sqlite.prepare("SELECT * FROM saved_searches ORDER BY id ASC").all();
  const searchRuns = sqlite.prepare("SELECT * FROM search_runs ORDER BY id ASC").all();
  const causeListSnapshots = sqlite.prepare("SELECT * FROM cause_list_snapshots ORDER BY id ASC").all();
  const syncState = sqlite.prepare("SELECT * FROM sync_state ORDER BY sync_key ASC").all();
  sqlite.close();
  return { savedSearches, searchRuns, causeListSnapshots, syncState };
}

async function main() {
  const baseUrl = process.env.IMPORT_BASE_URL?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const sqlitePath = process.env.SQLITE_DB_PATH ?? "D:\\highcourt\\highcourt.db";

  if (!baseUrl) {
    throw new Error("IMPORT_BASE_URL must be set.");
  }

  if (!cronSecret) {
    throw new Error("CRON_SECRET must be set.");
  }

  const payload = readSqlite(sqlitePath);

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/admin/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({
      mode: "replace",
      payload,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Import failed (${response.status}): ${text}`);
  }

  console.log(text);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
