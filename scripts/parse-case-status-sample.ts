import fs from "node:fs";
import path from "node:path";
import { extractCaseStatusRecords } from "../src/lib/caseStatusParser";

function main() {
  const samplePath = path.join(__dirname, "case-status-sample.json");
  const raw = fs.readFileSync(samplePath, "utf8");
  const records = extractCaseStatusRecords(raw);

  const preview = records.slice(0, 3).map((record, index) => ({
    index: index + 1,
    caseType: String(record.type_name ?? "-"),
    caseNumber: `${String(record.case_no2 ?? "-")}/${String(record.case_year ?? "-")}`,
    petitioner: String(record.pet_name ?? "-"),
    respondent: String(record.res_name ?? "-"),
    advocate: String(record.adv_name1 ?? "-"),
    status: record.date_of_decision ? "Disposed" : "Pending",
  }));

  console.log(
    JSON.stringify(
      {
        totalRecords: records.length,
        preview,
      },
      null,
      2,
    ),
  );
}

main();
