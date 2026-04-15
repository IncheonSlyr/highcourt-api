import express from "express";
import path from "node:path";
import { z } from "zod";
import { config } from "./config";
import { causeListCacheDb, getDbPool, initDb, resetAllData, savedSearchDb } from "./db";
import { buildCaseStatusDisplayResponse } from "./lib/caseStatusDisplay";
import { CauseListService } from "./services/causeListService";
import { CauseListSyncService } from "./services/causeListSyncService";
import { CaseStatusService } from "./services/caseStatusService";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
const dbReady = initDb();
app.use(async (_req, _res, next) => {
  await dbReady;
  next();
});

const causeListService = new CauseListService();
const causeListSyncService = new CauseListSyncService(causeListService);
const caseStatusService = new CaseStatusService();

const causeListQuerySchema = z.object({
  date: z.string(),
  side: z.enum(["A", "O", "J", "P"]),
  listType: z.enum(["D", "M", "S", "S2", "S3", "S4", "S5", "LA"]).default("D"),
});

const causeListSideSchema = z.enum(["A", "O", "J", "P"]);
const causeListTypeSchema = z.enum(["D", "M", "S", "S2", "S3", "S4", "S5", "LA"]);

function parseCsvEnumList<T extends string>(value: unknown, allowedValues: readonly T[]) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as T[];

  const uniqueParts = [...new Set(parts)];
  if (!uniqueParts.every((item) => allowedValues.includes(item))) {
    throw new Error(`Invalid list value in ${value}`);
  }

  return uniqueParts;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "highcourt-api",
    court: "Calcutta High Court",
    date: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/api/cause-lists/url", (req, res, next) => {
  try {
    const params = causeListQuerySchema.extend({ format: z.enum(["html", "pdf"]).default("html") }).parse(req.query);
    const url = causeListService.buildUrl(params.date, params.side, params.listType, params.format);
    res.json({ url, ...params });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cause-lists/fetch", async (req, res, next) => {
  try {
    const params = causeListQuerySchema.extend({ format: z.enum(["html", "pdf"]).default("html") }).parse(req.query);
    const result = await causeListService.fetchDocument(params.date, params.side, params.listType, params.format);
    res.json({
      ...params,
      sourceUrl: result.url,
      contentType: result.contentType,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cause-lists/search", async (req, res, next) => {
  try {
    const params = causeListQuerySchema.extend({ query: z.string().min(2) }).parse(req.query);
    const result = await causeListService.searchInCauseList(params);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/cause-lists/upcoming", async (req, res, next) => {
  try {
    const params = z
      .object({
        query: z.string().min(2),
        startDate: z.string().default(new Date().toISOString().slice(0, 10)),
        days: z.coerce.number().int().min(1).max(14).default(7),
      })
      .parse(req.query);

    const result = await causeListService.searchUpcoming(params);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/cause-lists/cache/search", async (req, res, next) => {
  try {
    const params = z
      .object({
        query: z.string().min(2),
        startDate: z.string().default(new Date().toISOString().slice(0, 10)),
        days: z.coerce.number().int().min(1).max(14).default(7),
      })
      .parse(req.query);
    const sides = parseCsvEnumList(req.query.sides, causeListSideSchema.options);
    const listTypes = parseCsvEnumList(req.query.listTypes, causeListTypeSchema.options);
    const syncInfo = await causeListSyncService.ensureSyncedForRange({ ...params, sides, listTypes });
    const searchResult = await causeListSyncService.searchCache({ ...params, sides, listTypes });
    res.json({
      ...searchResult,
      cacheInfo: syncInfo,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cause-lists/cache/recent", async (_req, res) => {
  res.json({ items: await causeListCacheDb.listRecent() });
});

app.get("/api/cause-lists/sync/status", async (_req, res) => {
  res.json({ status: await causeListSyncService.getStatus() });
});

app.post("/api/cause-lists/sync/run", async (req, res, next) => {
  try {
    const body = z
      .object({
        startDate: z.string().optional(),
        days: z.coerce.number().int().min(1).max(7).optional(),
        sides: z.array(causeListSideSchema).optional(),
        listTypes: z.array(causeListTypeSchema).optional(),
      })
      .parse(req.body ?? {});
    const result = await causeListSyncService.runSync(body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/case-status/benches", async (_req, res, next) => {
  try {
    const benches = await caseStatusService.getBenches();
    res.json({ stateCode: config.calcuttaHighCourtStateCode, benches });
  } catch (error) {
    next(error);
  }
});

app.get("/api/case-status/case-types", async (req, res, next) => {
  try {
    const courtCode = z.string().min(1).parse(req.query.courtCode);
    const caseTypes = await caseStatusService.getCaseTypes(courtCode);
    res.json({ courtCode, caseTypes });
  } catch (error) {
    next(error);
  }
});

app.post("/api/case-status/session", async (_req, res, next) => {
  try {
    const session = await caseStatusService.startSession();
    res.json(session);
  } catch (error) {
    next(error);
  }
});

app.get("/api/case-status/session/:sessionId/captcha", async (req, res, next) => {
  try {
    const sessionId = z.string().uuid().parse(req.params.sessionId);
    const image = await caseStatusService.fetchCaptchaImage(sessionId);
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(image.data);
  } catch (error) {
    next(error);
  }
});

app.post("/api/case-status/search/case-number", async (req, res, next) => {
  try {
    const body = z
      .object({
        sessionId: z.string().uuid(),
        captcha: z.string().min(4),
        courtCode: z.string().min(1),
        caseType: z.string().min(1),
        caseNumber: z.string().min(1),
        year: z.string().regex(/^\d{4}$/),
      })
      .parse(req.body);

    const result = await caseStatusService.searchByCaseNumber(body);
    res.json(buildCaseStatusDisplayResponse(result));
  } catch (error) {
    next(error);
  }
});

app.post("/api/case-status/search/party-name", async (req, res, next) => {
  try {
    const body = z
      .object({
        sessionId: z.string().uuid(),
        captcha: z.string().min(4),
        courtCode: z.string().min(1),
        partyName: z.string().min(3),
        year: z.string().regex(/^\d{4}$/),
        statusFilter: z.enum(["Pending", "Disposed", "Both"]).default("Both"),
      })
      .parse(req.body);

    const result = await caseStatusService.searchByPartyName(body);
    res.json(buildCaseStatusDisplayResponse(result));
  } catch (error) {
    next(error);
  }
});

app.post("/api/case-status/search/advocate-name", async (req, res, next) => {
  try {
    const body = z
      .object({
        sessionId: z.string().uuid(),
        captcha: z.string().min(4),
        courtCode: z.string().min(1),
        advocateName: z.string().min(3),
        statusFilter: z.enum(["Pending", "Disposed", "Both"]).default("Both"),
      })
      .parse(req.body);

    const result = await caseStatusService.searchByAdvocateName(body);
    res.json(buildCaseStatusDisplayResponse(result));
  } catch (error) {
    next(error);
  }
});

const savedSearchSchema = z.object({
  label: z.string().min(2),
  searchType: z.enum(["cause_list_text", "case_status_party", "case_status_advocate", "case_status_case_number"]),
  queryText: z.string().nullable().optional(),
  filtersJson: z.record(z.string(), z.unknown()).nullable().optional(),
  courtCode: z.string().nullable().optional(),
  statusFilter: z.enum(["Pending", "Disposed", "Both"]).nullable().optional(),
  caseType: z.string().nullable().optional(),
  caseNumber: z.string().nullable().optional(),
  year: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  initialRun: z
    .object({
      sourceType: z.string().min(2),
      resultJson: z.unknown(),
    })
    .optional(),
});

app.get("/api/saved-searches", async (_req, res) => {
  res.json({ items: await savedSearchDb.list() });
});

app.post("/api/saved-searches", async (req, res, next) => {
  try {
    const body = savedSearchSchema.parse(req.body);
    const record = await savedSearchDb.create({
      label: body.label,
      searchType: body.searchType,
      queryText: body.queryText ?? null,
      filtersJson: body.filtersJson ?? null,
      courtCode: body.courtCode ?? null,
      statusFilter: body.statusFilter ?? null,
      caseType: body.caseType ?? null,
      caseNumber: body.caseNumber ?? null,
      year: body.year ?? null,
      notes: body.notes ?? null,
    });
    if (!record) {
      throw new Error("Could not create saved search.");
    }

    if (body.initialRun) {
      await savedSearchDb.addRun(record.id, body.initialRun.sourceType, body.initialRun.resultJson);
    }

    res.status(201).json(await savedSearchDb.getWithLatestRun(record.id));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/saved-searches/:id", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const patch = savedSearchSchema.partial().parse(req.body);
    const record = await savedSearchDb.update(id, patch);
    if (!record) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/saved-searches/:id", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const deleted = await savedSearchDb.delete(id);
    if (!deleted) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/saved-searches/:id/runs", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    res.json({ runs: await savedSearchDb.listRuns(id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/saved-searches/:id/latest-run", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    res.json({ latestRun: await savedSearchDb.getLatestRun(id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/saved-searches/:id/run", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const record = await savedSearchDb.get(id);
    if (!record) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }

    if (record.searchType === "cause_list_text") {
      if (!record.queryText) {
        throw new Error("This saved search is missing queryText.");
      }

      const startDate = z.string().default(new Date().toISOString().slice(0, 10)).parse(req.body?.startDate);
      const days = z.coerce.number().int().min(1).max(14).default(7).parse(req.body?.days ?? 7);
      const savedSides = Array.isArray(record.filtersJson?.sides) ? (record.filtersJson.sides as Array<"A" | "O" | "J" | "P">) : undefined;
      const savedListTypes = Array.isArray(record.filtersJson?.listTypes)
        ? (record.filtersJson.listTypes as Array<"D" | "M" | "S" | "S2" | "S3" | "S4" | "S5" | "LA">)
        : undefined;
      const result = await causeListSyncService.searchCache({
        query: record.queryText,
        startDate,
        days,
        sides: savedSides,
        listTypes: savedListTypes,
      });
      await savedSearchDb.addRun(id, "cause_list_upcoming", result);
      res.json(result);
      return;
    }

    if (record.searchType === "case_status_party") {
      const body = z
        .object({
          sessionId: z.string().uuid(),
          captcha: z.string().min(4),
        })
        .parse(req.body);

      if (!record.queryText || !record.courtCode || !record.year) {
        throw new Error("Saved search needs queryText, courtCode, and year.");
      }

      const result = await caseStatusService.searchByPartyName({
        sessionId: body.sessionId,
        captcha: body.captcha,
        courtCode: record.courtCode,
        partyName: record.queryText,
        year: record.year,
        statusFilter: (record.statusFilter as "Pending" | "Disposed" | "Both" | null) ?? "Both",
      });
      const displayResult = buildCaseStatusDisplayResponse(result);
      await savedSearchDb.addRun(id, "case_status_party", displayResult);
      res.json(displayResult);
      return;
    }

    if (record.searchType === "case_status_advocate") {
      const body = z
        .object({
          sessionId: z.string().uuid(),
          captcha: z.string().min(4),
        })
        .parse(req.body);

      if (!record.queryText || !record.courtCode) {
        throw new Error("Saved search needs queryText and courtCode.");
      }

      const result = await caseStatusService.searchByAdvocateName({
        sessionId: body.sessionId,
        captcha: body.captcha,
        courtCode: record.courtCode,
        advocateName: record.queryText,
        statusFilter: (record.statusFilter as "Pending" | "Disposed" | "Both" | null) ?? "Both",
      });
      const displayResult = buildCaseStatusDisplayResponse(result);
      await savedSearchDb.addRun(id, "case_status_advocate", displayResult);
      res.json(displayResult);
      return;
    }

    if (record.searchType === "case_status_case_number") {
      const body = z
        .object({
          sessionId: z.string().uuid(),
          captcha: z.string().min(4),
        })
        .parse(req.body);

      if (!record.courtCode || !record.caseType || !record.caseNumber || !record.year) {
        throw new Error("Saved search needs courtCode, caseType, caseNumber, and year.");
      }

      const result = await caseStatusService.searchByCaseNumber({
        sessionId: body.sessionId,
        captcha: body.captcha,
        courtCode: record.courtCode,
        caseType: record.caseType,
        caseNumber: record.caseNumber,
        year: record.year,
      });
      const displayResult = buildCaseStatusDisplayResponse(result);
      await savedSearchDb.addRun(id, "case_status_case_number", displayResult);
      res.json(displayResult);
      return;
    }

    throw new Error("Unsupported saved search type.");
  } catch (error) {
    next(error);
  }
});

app.get("/api/cron/cause-list-sync", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (config.cronSecret && authHeader !== `Bearer ${config.cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const result = await causeListSyncService.runSync();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/import", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!config.cronSecret || authHeader !== `Bearer ${config.cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = z
      .object({
        mode: z.enum(["replace", "append"]).default("append"),
        payload: z.object({
          savedSearches: z.array(z.record(z.string(), z.unknown())).default([]),
          searchRuns: z.array(z.record(z.string(), z.unknown())).default([]),
          causeListSnapshots: z.array(z.record(z.string(), z.unknown())).default([]),
          syncState: z.array(z.record(z.string(), z.unknown())).default([]),
        }),
      })
      .parse(req.body ?? {});

    if (body.mode === "replace") {
      await resetAllData();
    }

    const pool = getDbPool();

    for (const row of body.payload.savedSearches) {
      await pool.query(
        `
        INSERT INTO saved_searches
          (id, label, search_type, query_text, filters_json, court_code, status_filter, case_type, case_number, year, notes, created_at, updated_at, last_run_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id)
        DO UPDATE SET
          label = EXCLUDED.label,
          search_type = EXCLUDED.search_type,
          query_text = EXCLUDED.query_text,
          filters_json = EXCLUDED.filters_json,
          court_code = EXCLUDED.court_code,
          status_filter = EXCLUDED.status_filter,
          case_type = EXCLUDED.case_type,
          case_number = EXCLUDED.case_number,
          year = EXCLUDED.year,
          notes = EXCLUDED.notes,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          last_run_at = EXCLUDED.last_run_at
        `,
        [
          Number(row.id),
          row.label ? String(row.label) : "",
          row.search_type ? String(row.search_type) : "",
          row.query_text ? String(row.query_text) : null,
          row.filters_json ?? null,
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

    for (const row of body.payload.searchRuns) {
      await pool.query(
        `
        INSERT INTO search_runs
          (id, saved_search_id, source_type, result_json, created_at)
        VALUES
          ($1, $2, $3, $4, $5)
        ON CONFLICT (id)
        DO UPDATE SET
          saved_search_id = EXCLUDED.saved_search_id,
          source_type = EXCLUDED.source_type,
          result_json = EXCLUDED.result_json,
          created_at = EXCLUDED.created_at
        `,
        [
          Number(row.id),
          Number(row.saved_search_id),
          row.source_type ? String(row.source_type) : "",
          row.result_json ?? {},
          row.created_at ? String(row.created_at) : new Date().toISOString(),
        ],
      );
    }

    for (const row of body.payload.causeListSnapshots) {
      await pool.query(
        `
        INSERT INTO cause_list_snapshots
          (id, source_date, side, list_type, source_url, title, subtitle, content_json, fetched_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (source_date, side, list_type)
        DO UPDATE SET
          source_url = EXCLUDED.source_url,
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          content_json = EXCLUDED.content_json,
          fetched_at = EXCLUDED.fetched_at
        `,
        [
          Number(row.id),
          row.source_date ? String(row.source_date) : "",
          row.side ? String(row.side) : "",
          row.list_type ? String(row.list_type) : "",
          row.source_url ? String(row.source_url) : "",
          row.title ? String(row.title) : null,
          row.subtitle ? String(row.subtitle) : null,
          row.content_json ?? {},
          row.fetched_at ? String(row.fetched_at) : new Date().toISOString(),
        ],
      );
    }

    for (const row of body.payload.syncState) {
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
        [
          row.sync_key ? String(row.sync_key) : "",
          row.last_run_at ? String(row.last_run_at) : null,
          row.last_status ? String(row.last_status) : null,
          row.last_message ? String(row.last_message) : null,
        ],
      );
    }

    await pool.query(`SELECT setval(pg_get_serial_sequence('saved_searches', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM saved_searches), 1), 1), true)`);
    await pool.query(`SELECT setval(pg_get_serial_sequence('search_runs', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM search_runs), 1), 1), true)`);
    await pool.query(`SELECT setval(pg_get_serial_sequence('cause_list_snapshots', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM cause_list_snapshots), 1), 1), true)`);

    res.json({
      ok: true,
      imported: {
        savedSearches: body.payload.savedSearches.length,
        searchRuns: body.payload.searchRuns.length,
        causeListSnapshots: body.payload.causeListSnapshots.length,
        syncState: body.payload.syncState.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(400).json({ error: message });
});

if (!config.isVercel) {
  app.listen(config.port, () => {
    console.log(`High Court API running on http://localhost:${config.port}`);
  });

  void causeListSyncService.runSync().catch((error) => {
    console.error("Initial cause-list sync failed:", error);
  });

  setInterval(() => {
    void causeListSyncService.runSync().catch((error) => {
      console.error("Scheduled cause-list sync failed:", error);
    });
  }, 10 * 60 * 1000);
}

export default app;
