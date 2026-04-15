import { extractCaseStatusRecords } from "./caseStatusParser";
import type { CaseStatusDisplayRecord, CaseStatusDisplayResponse } from "../types";

function normalizeText(value: unknown, fallback = "-") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text && text !== "NA" && text !== "N/A" && text !== "N" ? text : fallback;
}

function decisionInfo(entry: Record<string, unknown>) {
  const decisionDate = normalizeText(entry.date_of_decision, "");
  if (decisionDate) {
    return {
      status: "Disposed" as const,
      decisionDate,
    };
  }

  return {
    status: "Pending" as const,
    decisionDate: null,
  };
}

function advocates(entry: Record<string, unknown>) {
  return [entry.adv_name1, entry.adv_name2, entry.ladv_name1, entry.ladv_name2]
    .map((value) => normalizeText(value, ""))
    .filter(Boolean)
    .join(", ") || "-";
}

function parties(entry: Record<string, unknown>) {
  return {
    petitioner: normalizeText(entry.pet_name || entry.lpet_name),
    respondent: normalizeText(entry.res_name || entry.lres_name),
  };
}

export function buildCaseStatusDisplayResponse(payload: unknown): CaseStatusDisplayResponse {
  const records = extractCaseStatusRecords(payload);
  if (records.length) {
    const displayRecords = records.map((entry, index) => {
      const partyData = parties(entry);
      const decision = decisionInfo(entry);

      return {
        resultNumber: index + 1,
        caseTypeName: normalizeText(entry.type_name),
        caseNumber: `${normalizeText(entry.case_no2)}/${normalizeText(entry.case_year)}`,
        fullCaseNumber: normalizeText(entry.case_no),
        petitioner: partyData.petitioner,
        respondent: partyData.respondent,
        advocate: advocates(entry),
        cino: normalizeText(entry.cino),
        status: decision.status,
        decisionDate: decision.decisionDate,
      } satisfies CaseStatusDisplayRecord;
    });

    const summary = displayRecords.reduce(
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

    return {
      view: "records",
      totalRecords: displayRecords.length,
      pendingCount: summary.pendingCount,
      disposedCount: summary.disposedCount,
      records: displayRecords,
      html: null,
      message: null,
      raw: payload,
    };
  }

  if (payload && typeof payload === "object" && "raw" in (payload as Record<string, unknown>)) {
    const rawRecords = extractCaseStatusRecords((payload as { raw?: unknown }).raw);
    if (rawRecords.length) {
      return buildCaseStatusDisplayResponse(rawRecords);
    }
  }

  if (payload && typeof payload === "object" && typeof (payload as { con?: unknown }).con === "string") {
    const content = (payload as { con: string }).con.trim();
    if (content === "Invalid Captcha") {
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

    if (content.startsWith("<")) {
      return {
        view: "html",
        totalRecords: Number((payload as { totRecords?: unknown }).totRecords ?? 0),
        pendingCount: 0,
        disposedCount: 0,
        records: [],
        html: content,
        message: null,
        raw: payload,
      };
    }
  }

  return {
    view: "message",
    totalRecords: 0,
    pendingCount: 0,
    disposedCount: 0,
    records: [],
    html: null,
    message: "No structured case-status records were found in this response.",
    raw: payload,
  };
}
