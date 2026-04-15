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

export type CaseStatusDisplayRecord = {
  resultNumber: number;
  caseTypeName: string;
  caseNumber: string;
  fullCaseNumber: string;
  petitioner: string;
  respondent: string;
  advocate: string;
  cino: string;
  status: "Pending" | "Disposed";
  decisionDate: string | null;
};

export type CaseStatusDisplayResponse = {
  view: "records" | "html" | "message";
  totalRecords: number;
  pendingCount: number;
  disposedCount: number;
  records: CaseStatusDisplayRecord[];
  html: string | null;
  message: string | null;
  raw: unknown;
};

export type SavedSearchType =
  | "cause_list_text"
  | "case_status_party"
  | "case_status_advocate"
  | "case_status_case_number";
