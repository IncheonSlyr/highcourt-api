import * as cheerio from "cheerio";
import { config } from "../config";
import type { CaseStatusDisplayRecord, CaseStatusDisplayResponse } from "../types";

type RawRecord = Record<string, unknown>;

function text(value: unknown, fallback = "-") {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized && normalized !== "NA" && normalized !== "N/A" && normalized !== "N" ? normalized : fallback;
}

function blank(value: unknown) {
  return text(value, "");
}

function splitParties(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { petitioner: "-", respondent: "-" };
  }

  const parts = normalized.split(/\bversus\b/i);
  return {
    petitioner: text(parts[0] ?? ""),
    respondent: text(parts.slice(1).join(" ") ?? ""),
  };
}

function buildViewUrl(value: unknown) {
  const token = blank(value);
  if (!token) {
    return null;
  }

  return `${config.ecourtsBaseUrl}/cases_qry/view.php?orderurlpath=${encodeURIComponent(token)}`;
}

function mapJsonRecord(entry: RawRecord, index: number): CaseStatusDisplayRecord {
  const petitioner = text(entry.pet_name || entry.lpet_name);
  const respondent = text(entry.res_name || entry.lres_name);
  const decisionDate = blank(entry.date_of_decision) || null;
  const caseTypeName = text(entry.type_name);
  const shortNumber = `${text(entry.case_no2)}/${text(entry.case_year)}`;

  return {
    resultNumber: index + 1,
    caseTypeName,
    caseNumber: shortNumber,
    fullCaseNumber: text(entry.case_no, shortNumber),
    petitioner,
    respondent,
    advocate: [entry.adv_name1, entry.adv_name2, entry.ladv_name1, entry.ladv_name2]
      .map((item) => blank(item))
      .filter(Boolean)
      .join(", ") || "-",
    cino: text(entry.cino),
    status: decisionDate ? "Disposed" : "Pending",
    decisionDate,
    viewUrl: buildViewUrl(entry.orderurlpath),
  };
}

function mapHtmlRecord(cells: string[], index: number, viewUrl: string | null): CaseStatusDisplayRecord {
  const caseColumn = text(cells[1] ?? "");
  const parties = splitParties(cells[2] ?? "");
  const caseParts = caseColumn.split("/");
  const caseTypeName = text(caseParts[0] ?? caseColumn);

  return {
    resultNumber: Number.parseInt(text(cells[0] ?? `${index + 1}`, `${index + 1}`), 10) || index + 1,
    caseTypeName,
    caseNumber: caseColumn,
    fullCaseNumber: caseColumn,
    petitioner: parties.petitioner,
    respondent: parties.respondent,
    advocate: text(cells[3] ?? ""),
    cino: "-",
    status: "Pending",
    decisionDate: null,
    viewUrl,
  };
}

function isCaseStatusRecord(payload: RawRecord) {
  return [
    "orderurlpath",
    "cino",
    "case_no",
    "case_type",
    "case_year",
    "case_no2",
    "pet_name",
    "res_name",
    "adv_name1",
    "type_name",
  ].some((key) => key in payload);
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractBalanced(value: string, startIndex: number, openChar: string, closeChar: string) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractAssignedCon(value: string) {
  const matcher = /["']?con["']?\s*[:=]\s*/g;
  let match;

  while ((match = matcher.exec(value)) !== null) {
    let index = match.index + match[0].length;
    while (index < value.length && /\s/.test(value[index])) {
      index += 1;
    }

    const start = value[index];
    if (start === "[") {
      const chunk = extractBalanced(value, index, "[", "]");
      if (chunk) {
        return chunk;
      }
    }

    if (start === "{") {
      const chunk = extractBalanced(value, index, "{", "}");
      if (chunk) {
        return chunk;
      }
    }

    if (start === "\"" || start === "'") {
      const quote = start;
      let endIndex = index + 1;
      let escaped = false;

      while (endIndex < value.length) {
        const char = value[endIndex];
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          break;
        }
        endIndex += 1;
      }

      return value.slice(index + 1, endIndex);
    }
  }

  return null;
}

function extractJsonObjects(value: string) {
  const records: RawRecord[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const parsed = tryParseJson(value.slice(start, index + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          records.push(parsed as RawRecord);
        }
        start = -1;
      }
    }
  }

  return records;
}

function collectJsonRecords(payload: unknown): RawRecord[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object") as RawRecord[];
  }

  if (typeof payload === "string") {
    const trimmed = payload.replace(/^\uFEFF/, "").trim();
    if (!trimmed) {
      return [];
    }

    const parsed = tryParseJson(trimmed);
    if (parsed !== null) {
      return collectJsonRecords(parsed);
    }

    const assignedCon = extractAssignedCon(trimmed);
    if (assignedCon) {
      const nested = collectJsonRecords(assignedCon);
      if (nested.length) {
        return nested;
      }
    }

    return extractJsonObjects(trimmed).filter(isCaseStatusRecord);
  }

  if (typeof payload === "object") {
    const objectPayload = payload as RawRecord;
    if (isCaseStatusRecord(objectPayload)) {
      return [objectPayload];
    }

    if ("records" in objectPayload) {
      const nested = collectJsonRecords(objectPayload.records);
      if (nested.length) {
        return nested;
      }
    }

    if ("con" in objectPayload) {
      const nested = collectJsonRecords(objectPayload.con);
      if (nested.length) {
        return nested;
      }
    }

    if ("raw" in objectPayload) {
      const nested = collectJsonRecords(objectPayload.raw);
      if (nested.length) {
        return nested;
      }
    }
  }

  return [];
}

function extractHtmlString(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("<")) {
      return trimmed;
    }

    const assignedCon = extractAssignedCon(trimmed);
    if (assignedCon?.trim().startsWith("<")) {
      return assignedCon.trim();
    }

    const parsed = tryParseJson(trimmed);
    if (parsed !== null) {
      return extractHtmlString(parsed);
    }

    return null;
  }

  if (typeof payload === "object") {
    const objectPayload = payload as RawRecord;
    if (typeof objectPayload.con === "string") {
      return extractHtmlString(objectPayload.con);
    }
    if (typeof objectPayload.raw === "string" || typeof objectPayload.raw === "object") {
      return extractHtmlString(objectPayload.raw);
    }
  }

  return null;
}

function extractTotalFromHtml(html: string) {
  const textMatch = html.match(/Total\s+Number\s+of\s+Cases\s*:\s*(\d+)/i);
  return textMatch ? Number(textMatch[1]) : 0;
}

function extractHtmlRecords(html: string) {
  const $ = cheerio.load(html);
  const records: CaseStatusDisplayRecord[] = [];

  $("table tr").each((index, row) => {
    const cells = $(row)
      .find("td")
      .toArray()
      .map((cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (cells.length < 4) {
      return;
    }

    const anchor = $(row).find("a").first();
    const href = anchor.attr("href");
    const viewUrl = href ? new URL(href, config.ecourtsBaseUrl).toString() : null;
    records.push(mapHtmlRecord(cells, records.length, viewUrl));
  });

  return records;
}

function invalidCaptcha(payload: unknown): boolean {
  if (!payload) {
    return false;
  }

  if (typeof payload === "string") {
    return payload.trim() === "Invalid Captcha";
  }

  if (typeof payload === "object") {
    const objectPayload = payload as RawRecord;
    return invalidCaptcha(objectPayload.con) || invalidCaptcha(objectPayload.raw);
  }

  return false;
}

function summarize(records: CaseStatusDisplayRecord[]) {
  return records.reduce(
    (accumulator, record) => {
      if (record.status === "Disposed") {
        accumulator.disposedCount += 1;
      } else {
        accumulator.pendingCount += 1;
      }
      return accumulator;
    },
    { pendingCount: 0, disposedCount: 0 },
  );
}

function recordsResponse(records: CaseStatusDisplayRecord[], raw: unknown): CaseStatusDisplayResponse {
  const summary = summarize(records);
  return {
    view: "records",
    totalRecords: records.length,
    pendingCount: summary.pendingCount,
    disposedCount: summary.disposedCount,
    records,
    html: null,
    message: null,
    raw,
  };
}

export function buildCaseStatusResults(payload: unknown): CaseStatusDisplayResponse {
  const jsonRecords = collectJsonRecords(payload)
    .filter(isCaseStatusRecord)
    .map(mapJsonRecord);

  if (jsonRecords.length) {
    return recordsResponse(jsonRecords, payload);
  }

  const html = extractHtmlString(payload);
  if (html) {
    const htmlRecords = extractHtmlRecords(html);
    if (htmlRecords.length) {
      const response = recordsResponse(htmlRecords, payload);
      response.totalRecords = Math.max(response.totalRecords, extractTotalFromHtml(html));
      response.html = html;
      return response;
    }

    return {
      view: "html",
      totalRecords: extractTotalFromHtml(html),
      pendingCount: 0,
      disposedCount: 0,
      records: [],
      html,
      message: null,
      raw: payload,
    };
  }

  if (invalidCaptcha(payload)) {
    return {
      view: "message",
      totalRecords: 0,
      pendingCount: 0,
      disposedCount: 0,
      records: [],
      html: null,
      message: "The captcha did not match this session. Load a fresh captcha and try again.",
      raw: payload,
    };
  }

  return {
    view: "message",
    totalRecords: 0,
    pendingCount: 0,
    disposedCount: 0,
    records: [],
    html: null,
    message: "The court response could not be converted into readable case-status results.",
    raw: payload,
  };
}
