import { constants } from "node:crypto";
import https from "node:https";
import axios from "axios";
import { CookieJar } from "tough-cookie";
import { HttpsCookieAgent } from "http-cookie-agent/http";

export const legacyHttpsAgent = new https.Agent({
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

export const http = axios.create({
  timeout: 30000,
  httpsAgent: legacyHttpsAgent,
  headers: {
    "User-Agent": "highcourt-service/1.0",
  },
});

export function createCookieHttpClient(jar: CookieJar) {
  const httpsAgent = new HttpsCookieAgent({
    cookies: { jar },
    secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
  });

  return axios.create({
    timeout: 30000,
    httpsAgent,
    withCredentials: true,
    headers: {
      "User-Agent": "highcourt-service/1.0",
    },
  });
}
