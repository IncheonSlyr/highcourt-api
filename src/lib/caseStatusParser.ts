export type CaseStatusRecord = Record<string, unknown>;

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonObjects(value: string) {
  const records: CaseStatusRecord[] = [];
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
        const chunk = value.slice(start, index + 1);
        const parsed = tryParseJson(chunk);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          records.push(parsed as CaseStatusRecord);
        }
        start = -1;
      }
    }
  }

  return records;
}

export function extractCaseStatusRecords(payload: unknown): CaseStatusRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object") as CaseStatusRecord[];
  }

  if (!payload) {
    return [];
  }

  if (typeof payload === "string") {
    const trimmed = payload.replace(/^\uFEFF/, "").trim();
    if (!trimmed) {
      return [];
    }

    const parsed = tryParseJson(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item === "object") as CaseStatusRecord[];
    }

    if (parsed && typeof parsed === "object") {
      return extractCaseStatusRecords(parsed);
    }

    return extractJsonObjects(trimmed);
  }

  if (typeof payload === "object") {
    const objectPayload = payload as Record<string, unknown>;

    if (Array.isArray(objectPayload.records)) {
      return objectPayload.records.filter((item) => item && typeof item === "object") as CaseStatusRecord[];
    }

    if (typeof objectPayload.con === "string" || Array.isArray(objectPayload.con)) {
      return extractCaseStatusRecords(objectPayload.con);
    }
  }

  return [];
}

export function normalizeCaseStatusPayload(payload: unknown) {
  const records = extractCaseStatusRecords(payload);
  if (records.length) {
    return records;
  }

  if (typeof payload === "string") {
    const trimmed = payload.replace(/^\uFEFF/, "").trim();
    const parsed = tryParseJson(trimmed);
    return parsed ?? payload;
  }

  return payload;
}
