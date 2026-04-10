export type CauseListSide = "A" | "O" | "J" | "P";
export type CauseListType = "D" | "M" | "S" | "S2" | "S3" | "S4" | "S5" | "LA";
export type CauseListFormat = "html" | "pdf";

export type CauseListEntry = {
  serial: string;
  caseNumbers: string[];
  primaryCaseNumber: string;
  parties: string;
  advocates: string;
  section: string | null;
  courtNo: string | null;
  bench: string | null;
  rawText: string;
};

export type CaseStatusSearchRequest = {
  sessionId: string;
  captcha: string;
  courtCode: string;
  caseType: string;
  caseNumber: string;
  year: string;
};

export type SearchStatusFilter = "Pending" | "Disposed" | "Both";

export type SavedSearchType =
  | "cause_list_text"
  | "case_status_party"
  | "case_status_advocate"
  | "case_status_case_number";
