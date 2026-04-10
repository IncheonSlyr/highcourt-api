import * as cheerio from "cheerio";
import { http } from "../lib/http";
import type { CauseListEntry, CauseListFormat, CauseListSide, CauseListType } from "../types";
import { config } from "../config";

const sideMap: Record<CauseListSide, { prefix: string; infix: string }> = {
  A: { prefix: "AS", infix: "a" },
  O: { prefix: "OS", infix: "" },
  J: { prefix: "J", infix: "j" },
  P: { prefix: "PB", infix: "pb" },
};

const typeMap: Record<CauseListType, string> = {
  D: "",
  M: "monthly/",
  S: "supplementary/",
  S2: "supplementary2/",
  S3: "supplementary3/",
  S4: "supplementary4/",
  S5: "supplementary5/",
  LA: "lok_adalat/",
};

function toDdMmYyyy(date: string) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }

  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const year = value.getUTCFullYear();
  return `${day}${month}${year}`;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();
}

function normalizeSearchText(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesQuery(haystack: string, query: string) {
  const normalizedHaystack = normalizeSearchText(haystack);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return false;
  }

  if (normalizedHaystack.includes(normalizedQuery)) {
    return true;
  }

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) => normalizedHaystack.includes(token));
}

function extractCaseNumbers(text: string) {
  const matches = text.match(/[A-Z][A-Z.\-() ]*\/\d+\/\d{4}/g) ?? [];
  return [...new Set(matches.map((item) => normalizeText(item)))];
}

export class CauseListService {
  buildUrl(date: string, side: CauseListSide, listType: CauseListType, format: CauseListFormat) {
    const dateToken = toDdMmYyyy(date);
    const sideInfo = sideMap[side];
    const folder = typeMap[listType];
    return `${config.calcuttaHighCourtBaseUrl}/downloads/old_cause_lists/${folder}${sideInfo.prefix}/cl${sideInfo.infix}${dateToken}.${format}`;
  }

  async fetchDocument(date: string, side: CauseListSide, listType: CauseListType, format: CauseListFormat) {
    const url = this.buildUrl(date, side, listType, format);
    const response = await http.get<string>(url, {
      responseType: format === "pdf" ? "arraybuffer" : "text",
    });

    return {
      url,
      format,
      contentType: response.headers["content-type"] ?? null,
      data:
        format === "pdf"
          ? Buffer.from(response.data as unknown as ArrayBuffer).toString("base64")
          : (response.data as unknown as string),
    };
  }

  parseHtml(html: string) {
    const $ = cheerio.load(html);
    const pageTitle = normalizeText($("h2").first().text() || $("h3").first().text() || "Cause List");
    const pageSubtitle = normalizeText($("h3").first().text());

    const entries: CauseListEntry[] = [];
    let currentCourtNo: string | null = null;
    let currentBench: string | null = null;
    let currentSection: string | null = null;

    $("tr").each((_, row) => {
      const cells = $(row).find("td");
      const rawText = normalizeText($(row).text());

      if (!rawText) {
        return;
      }

      if (/^COURT NO\./i.test(rawText)) {
        currentCourtNo = rawText;
        return;
      }

      if (/BENCH/i.test(rawText) && !/CASE/i.test(rawText)) {
        currentBench = rawText;
        return;
      }

      if ($(row).find("center").length > 0 || $(row).find("u").length > 0) {
        currentSection = rawText;
      }

      if (cells.length < 4) {
        return;
      }

      const caseCellText = normalizeText($(cells[1]).text());
      const caseNumbers = extractCaseNumbers(caseCellText);
      if (caseNumbers.length === 0) {
        return;
      }

      entries.push({
        serial: normalizeText($(cells[0]).text()),
        caseNumbers,
        primaryCaseNumber: caseNumbers[0],
        parties: normalizeText($(cells[2]).text()),
        advocates: normalizeText($(cells[3]).text()),
        section: currentSection,
        courtNo: currentCourtNo,
        bench: currentBench,
        rawText,
      });
    });

    return {
      title: pageTitle,
      subtitle: pageSubtitle,
      totalEntries: entries.length,
      entries,
    };
  }

  async searchInCauseList(params: {
    date: string;
    side: CauseListSide;
    listType: CauseListType;
    query: string;
  }) {
    const document = await this.fetchDocument(params.date, params.side, params.listType, "html");
    const parsed = this.parseHtml(document.data as string);
    const matches = parsed.entries.filter((entry) =>
      matchesQuery(
        [entry.primaryCaseNumber, ...entry.caseNumbers, entry.parties, entry.advocates, entry.rawText].join(" "),
        params.query,
      ),
    );

    return {
      ...parsed,
      sourceUrl: document.url,
      query: params.query,
      matches,
      matchCount: matches.length,
    };
  }

  async searchUpcoming(params: {
    query: string;
    startDate: string;
    days: number;
    sides?: CauseListSide[];
    listTypes?: CauseListType[];
  }) {
    const sides = params.sides ?? ["A", "O", "J", "P"];
    const listTypes = params.listTypes ?? ["D", "S", "S2", "S3", "S4", "S5"];
    const start = new Date(params.startDate);
    const results: unknown[] = [];

    for (let index = 0; index < params.days; index += 1) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const dateText = date.toISOString().slice(0, 10);

      for (const side of sides) {
        for (const listType of listTypes) {
          try {
            const result = await this.searchInCauseList({
              date: dateText,
              side,
              listType,
              query: params.query,
            });

            if (result.matchCount > 0) {
              results.push({
                date: dateText,
                side,
                listType,
                sourceUrl: result.sourceUrl,
                matchCount: result.matchCount,
                matches: result.matches,
              });
            }
          } catch {
            continue;
          }
        }
      }
    }

    return {
      query: params.query,
      startDate: params.startDate,
      days: params.days,
      totalListsWithMatches: results.length,
      results,
    };
  }
}
