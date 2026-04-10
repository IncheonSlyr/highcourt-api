import { causeListCacheDb, syncStateDb } from "../db";
import type { CauseListSide, CauseListType } from "../types";
import { CauseListService } from "./causeListService";

const DEFAULT_SIDES: CauseListSide[] = ["A", "O", "J", "P"];
const DEFAULT_TYPES: CauseListType[] = ["D", "M", "S", "S2", "S3", "S4", "S5", "LA"];

export class CauseListSyncService {
  constructor(private readonly causeListService: CauseListService) {}

  private endDate(startDate: string, days: number) {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + days - 1);
    return date.toISOString().slice(0, 10);
  }

  async runSync(input?: {
    startDate?: string;
    days?: number;
    sides?: CauseListSide[];
    listTypes?: CauseListType[];
  }) {
    const startDate = input?.startDate ?? new Date().toISOString().slice(0, 10);
    const days = input?.days ?? 3;
    const sides = input?.sides ?? DEFAULT_SIDES;
    const listTypes = input?.listTypes ?? DEFAULT_TYPES;
    const start = new Date(startDate);

    let synced = 0;
    let attempted = 0;
    let notFound = 0;
    const errors: string[] = [];

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const current = new Date(start);
      current.setUTCDate(start.getUTCDate() + dayOffset);
      const dateText = current.toISOString().slice(0, 10);

      for (const side of sides) {
        for (const listType of listTypes) {
          attempted += 1;
          try {
            const document = await this.causeListService.fetchDocument(dateText, side, listType, "html");
            const parsed = this.causeListService.parseHtml(document.data as string);
            causeListCacheDb.upsertSnapshot({
              sourceDate: dateText,
              side,
              listType,
              sourceUrl: document.url,
              title: parsed.title,
              subtitle: parsed.subtitle,
              contentJson: parsed,
            });
            synced += 1;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown fetch error";
            if (message.includes("404")) {
              notFound += 1;
            }
            if (errors.length < 8) {
              errors.push(`${dateText} ${side} ${listType}: ${message}`);
            }
            continue;
          }
        }
      }
    }

    const success = synced > 0;
    const message = success
      ? `Synced ${synced} of ${attempted} cause-list files for ${startDate} to ${this.endDate(startDate, days)}.`
      : `No cause-list files were synced for ${startDate} to ${this.endDate(startDate, days)}. ${notFound > 0 ? `${notFound} combinations were not available on the website.` : "The website did not return usable files."}`;
    syncStateDb.set("cause_list_sync", success ? "ok" : "warning", message);
    return {
      startDate,
      days,
      synced,
      attempted,
      notFound,
      status: success ? "ok" : "warning",
      message,
      sampleErrors: errors,
    };
  }

  getStatus() {
    return syncStateDb.get("cause_list_sync");
  }

  searchCache(params: { query: string; startDate: string; days: number; sides?: CauseListSide[]; listTypes?: CauseListType[] }) {
    const endDate = this.endDate(params.startDate, params.days);
    const results = causeListCacheDb.search({
      query: params.query,
      startDate: params.startDate,
      endDate,
      sides: params.sides,
      listTypes: params.listTypes,
    });

    return {
      query: params.query,
      startDate: params.startDate,
      endDate,
      sides: params.sides ?? DEFAULT_SIDES,
      listTypes: params.listTypes ?? DEFAULT_TYPES,
      totalListsWithMatches: results.length,
      results,
    };
  }

  async ensureSyncedForRange(params: {
    startDate: string;
    days: number;
    sides?: CauseListSide[];
    listTypes?: CauseListType[];
  }) {
    const sides = params.sides ?? DEFAULT_SIDES;
    const listTypes = params.listTypes ?? DEFAULT_TYPES;
    const endDate = this.endDate(params.startDate, params.days);
    const cachedCountBefore = causeListCacheDb.countSnapshots({
      startDate: params.startDate,
      endDate,
      sides,
      listTypes,
    });
    const expectedCombinationCount = params.days * sides.length * listTypes.length;

    if (cachedCountBefore >= expectedCombinationCount) {
      return {
        autoSynced: false,
        cachedCountBefore,
        cachedCountAfter: cachedCountBefore,
        expectedCombinationCount,
        syncResult: null,
      };
    }

    const syncResult = await this.runSync({ ...params, sides, listTypes });
    const cachedCountAfter = causeListCacheDb.countSnapshots({
      startDate: params.startDate,
      endDate,
      sides,
      listTypes,
    });

    return {
      autoSynced: true,
      cachedCountBefore,
      cachedCountAfter,
      expectedCombinationCount,
      syncResult,
    };
  }
}
