import express from "express";
import path from "node:path";
import { z } from "zod";
import { config } from "./config";
import { causeListCacheDb, savedSearchDb } from "./db";
import { CauseListService } from "./services/causeListService";
import { CauseListSyncService } from "./services/causeListSyncService";
import { CaseStatusService } from "./services/caseStatusService";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

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
    const searchResult = causeListSyncService.searchCache({ ...params, sides, listTypes });
    res.json({
      ...searchResult,
      cacheInfo: syncInfo,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cause-lists/cache/recent", (_req, res) => {
  res.json({ items: causeListCacheDb.listRecent() });
});

app.get("/api/cause-lists/sync/status", (_req, res) => {
  res.json({ status: causeListSyncService.getStatus() });
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
    res.json(result);
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
    res.json(result);
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
    res.json(result);
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

app.get("/api/saved-searches", (_req, res) => {
  res.json({ items: savedSearchDb.list() });
});

app.post("/api/saved-searches", (req, res, next) => {
  try {
    const body = savedSearchSchema.parse(req.body);
    const record = savedSearchDb.create({
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
      savedSearchDb.addRun(record.id, body.initialRun.sourceType, body.initialRun.resultJson);
    }

    res.status(201).json(savedSearchDb.getWithLatestRun(record.id));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/saved-searches/:id", (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const patch = savedSearchSchema.partial().parse(req.body);
    const record = savedSearchDb.update(id, patch);
    if (!record) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/saved-searches/:id", (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const deleted = savedSearchDb.delete(id);
    if (!deleted) {
      res.status(404).json({ error: "Saved search not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/saved-searches/:id/runs", (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    res.json({ runs: savedSearchDb.listRuns(id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/saved-searches/:id/latest-run", (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    res.json({ latestRun: savedSearchDb.getLatestRun(id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/saved-searches/:id/run", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const record = savedSearchDb.get(id);
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
      const result = causeListSyncService.searchCache({
        query: record.queryText,
        startDate,
        days,
        sides: savedSides,
        listTypes: savedListTypes,
      });
      savedSearchDb.addRun(id, "cause_list_upcoming", result);
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
      savedSearchDb.addRun(id, "case_status_party", result);
      res.json(result);
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
      savedSearchDb.addRun(id, "case_status_advocate", result);
      res.json(result);
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
      savedSearchDb.addRun(id, "case_status_case_number", result);
      res.json(result);
      return;
    }

    throw new Error("Unsupported saved search type.");
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected error";
  res.status(400).json({ error: message });
});

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
