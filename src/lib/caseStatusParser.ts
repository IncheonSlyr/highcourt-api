export type CaseStatusRecord = Record<string, unknown>;

function looksLikeCaseStatusRecord(payload: Record<string, unknown>) {
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

function extractBalancedChunk(value: string, startIndex: number, openChar: string, closeChar: string) {
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

function extractAssignedConPayload(value: string) {
  const matcher = /["']?con["']?\s*[:=]\s*/g;
  let match;

  while ((match = matcher.exec(value)) !== null) {
    let index = match.index + match[0].length;
    while (index < value.length && /\s/.test(value[index])) {
      index += 1;
    }

    const startChar = value[index];
    if (!startChar) {
      continue;
    }

    if (startChar === "[") {
      const chunk = extractBalancedChunk(value, index, "[", "]");
      if (chunk) {
        return extractCaseStatusRecords(chunk);
      }
      continue;
    }

    if (startChar === "{") {
      const chunk = extractBalancedChunk(value, index, "{", "}");
      if (chunk) {
        return extractCaseStatusRecords(chunk);
      }
      continue;
    }

    if (startChar === "\"" || startChar === "'") {
      const quote = startChar;
      let escaped = false;
      let endIndex = index + 1;

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

      const chunk = value.slice(index + 1, endIndex);
      const unescaped = quote === "\"" ? chunk.replace(/\\"/g, "\"") : chunk.replace(/\\'/g, "'");
      const nestedRecords = extractCaseStatusRecords(unescaped);
      if (nestedRecords.length) {
        return nestedRecords;
      }
    }
  }

  return [];
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

    const wrappedConRecords = extractAssignedConPayload(trimmed);
    if (wrappedConRecords.length) {
      return wrappedConRecords;
    }

    return extractJsonObjects(trimmed);
  }

  if (typeof payload === "object") {
    const objectPayload = payload as Record<string, unknown>;

    if (looksLikeCaseStatusRecord(objectPayload)) {
      return [objectPayload];
    }

    if (Array.isArray(objectPayload.records)) {
      return objectPayload.records.filter((item) => item && typeof item === "object") as CaseStatusRecord[];
    }

    if ("con" in objectPayload) {
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
