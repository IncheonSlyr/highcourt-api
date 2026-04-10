import * as cheerio from "cheerio";
import { CookieJar } from "tough-cookie";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { createCookieHttpClient, http } from "../lib/http";
import type { CaseStatusSearchRequest, SearchStatusFilter } from "../types";

type SessionRecord = {
  id: string;
  jar: CookieJar;
  captchaImageUrl: string;
  createdAt: string;
};

function parseHashOptions(payload: string) {
  return payload
    .replace(/^\uFEFF/, "")
    .split("#")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [value, label] = item.split("~");
      return { value, label };
    });
}

export class CaseStatusService {
  private sessions = new Map<string, SessionRecord>();

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async getBenches() {
    const response = await http.post<string>(
      `${config.ecourtsBaseUrl}/cases_qry/index_qry.php`,
      new URLSearchParams({
        action_code: "fillHCBench",
        state_code: config.calcuttaHighCourtStateCode,
        appFlag: "web",
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    return parseHashOptions(response.data);
  }

  async getCaseTypes(courtCode: string) {
    const response = await http.post<string>(
      `${config.ecourtsBaseUrl}/cases_qry/index_qry.php?action_code=fillCaseType`,
      new URLSearchParams({
        court_code: courtCode,
        state_code: config.calcuttaHighCourtStateCode,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    const body = response.data.replace(/^\uFEFF/, "").trim();
    if (body.toUpperCase().startsWith("THERE IS AN ERROR")) {
      throw new Error("The eCourts service rejected the bench code while loading case types.");
    }

    return parseHashOptions(body);
  }

  async startSession() {
    const jar = new CookieJar();
    const client = createCookieHttpClient(jar);

    const response = await client.get<string>(`${config.ecourtsBaseUrl}/main.php`);
    const $ = cheerio.load(response.data);
    const captchaImagePath = $("#captcha_image").attr("src");

    if (!captchaImagePath) {
      throw new Error("Could not find captcha image on the eCourts page.");
    }

    const id = uuidv4();
    const captchaImageUrl = new URL(captchaImagePath, config.ecourtsBaseUrl).toString();
    this.sessions.set(id, {
      id,
      jar,
      captchaImageUrl,
      createdAt: new Date().toISOString(),
    });

    return {
      sessionId: id,
      captchaImageUrl: `/api/case-status/session/${id}/captcha`,
      createdAt: new Date().toISOString(),
      expiresNote: "Use the same sessionId and captcha answer for the next search call.",
    };
  }

  async fetchCaptchaImage(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Unknown or expired sessionId. Start a new captcha session first.");
    }

    const client = createCookieHttpClient(session.jar);
    const response = await client.get<ArrayBuffer>(session.captchaImageUrl, {
      responseType: "arraybuffer",
    });

    return {
      contentType: response.headers["content-type"] ?? "image/png",
      data: Buffer.from(response.data),
    };
  }

  async searchByCaseNumber(input: CaseStatusSearchRequest) {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error("Unknown or expired sessionId. Start a new captcha session first.");
    }

    const client = createCookieHttpClient(session.jar);

    const response = await client.post(
      `${config.ecourtsBaseUrl}/cases_qry/index_qry.php?action_code=showRecords`,
      new URLSearchParams({
        court_code: input.courtCode,
        state_code: config.calcuttaHighCourtStateCode,
        court_complex_code: input.courtCode,
        caseStatusSearchType: "CScaseNumber",
        captcha: input.captcha,
        case_type: input.caseType,
        case_no: input.caseNumber,
        rgyear: input.year,
        caseNoType: "new",
        displayOldCaseNo: "NO",
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    return response.data;
  }

  async searchByPartyName(input: {
    sessionId: string;
    captcha: string;
    courtCode: string;
    partyName: string;
    year: string;
    statusFilter: SearchStatusFilter;
  }) {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error("Unknown or expired sessionId. Start a new captcha session first.");
    }

    const client = createCookieHttpClient(session.jar);

    const response = await client.post(
      `${config.ecourtsBaseUrl}/cases_qry/index_qry.php?action_code=showRecords`,
      new URLSearchParams({
        court_code: input.courtCode,
        state_code: config.calcuttaHighCourtStateCode,
        court_complex_code: input.courtCode,
        caseStatusSearchType: "CSpartyName",
        captcha: input.captcha,
        f: input.statusFilter,
        petres_name: input.partyName,
        rgyear: input.year,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    return response.data;
  }

  async searchByAdvocateName(input: {
    sessionId: string;
    captcha: string;
    courtCode: string;
    advocateName: string;
    statusFilter: SearchStatusFilter;
  }) {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error("Unknown or expired sessionId. Start a new captcha session first.");
    }

    const client = createCookieHttpClient(session.jar);

    const response = await client.post(
      `${config.ecourtsBaseUrl}/cases_qry/index_qry.php?action_code=showRecords`,
      new URLSearchParams({
        court_code: input.courtCode,
        state_code: config.calcuttaHighCourtStateCode,
        court_complex_code: input.courtCode,
        caseStatusSearchType: "CSAdvName",
        captcha: input.captcha,
        advocate_name: input.advocateName,
        search_type: "1",
        f: input.statusFilter,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    return response.data;
  }
}
