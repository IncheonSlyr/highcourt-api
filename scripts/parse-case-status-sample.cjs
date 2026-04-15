const fs = require("node:fs");
const path = require("node:path");

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractCaseStatusObjects(value) {
  const records = [];
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
          records.push(parsed);
        }
        start = -1;
      }
    }
  }

  return records;
}

function getCaseStatusRecords(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object");
  }

  if (!payload) {
    return [];
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    const parsed = tryParseJson(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      return getCaseStatusRecords(parsed);
    }
    return extractCaseStatusObjects(trimmed);
  }

  if (typeof payload === "object") {
    if (Array.isArray(payload.records)) {
      return payload.records.filter((item) => item && typeof item === "object");
    }

    if (typeof payload.con === "string" || Array.isArray(payload.con)) {
      return getCaseStatusRecords(payload.con);
    }
  }

  return [];
}

const samplePath = path.join(__dirname, "case-status-sample.json");
const raw = fs.readFileSync(samplePath, "utf8");
const records = getCaseStatusRecords(raw);

const preview = records.map((record, index) => ({
  index: index + 1,
  caseType: String(record.type_name || "-"),
  caseNumber: `${String(record.case_no2 || "-")}/${String(record.case_year || "-")}`,
  petitioner: String(record.pet_name || "-"),
  respondent: String(record.res_name || "-"),
  advocate: String(record.adv_name1 || "-"),
  status: record.date_of_decision ? "Disposed" : "Pending",
}));

console.log(JSON.stringify({ totalRecords: records.length, preview }, null, 2));
