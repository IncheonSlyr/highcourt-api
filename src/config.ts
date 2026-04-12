import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  isVercel: process.env.VERCEL === "1",
  calcuttaHighCourtBaseUrl: "https://www.calcuttahighcourt.gov.in",
  ecourtsBaseUrl: "https://hcservices.ecourts.gov.in/hcservices",
  calcuttaHighCourtStateCode: "16",
};
