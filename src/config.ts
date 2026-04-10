import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  calcuttaHighCourtBaseUrl: "https://www.calcuttahighcourt.gov.in",
  ecourtsBaseUrl: "https://hcservices.ecourts.gov.in/hcservices",
  calcuttaHighCourtStateCode: "16",
};
