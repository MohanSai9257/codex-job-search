import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import XLSX from "xlsx";
import { db, config, setSetting } from "./db.js";

const normalizeHeader = (value) => String(value || "").trim().toLowerCase();

export function parseExcelCompanies(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (!rows.length) throw new Error("The Excel file is empty");

  const headers = rows[0].map(normalizeHeader);
  const nameIndex = headers.findIndex((header) => header === "company name" || header === "company");
  const careersIndex = headers.findIndex((header) => header === "careers url" || header === "career url");
  const companyColumn = nameIndex >= 0 ? nameIndex : 0;
  const seen = new Set();

  return rows.slice(1).flatMap((row, index) => {
    const name = String(row[companyColumn] || "").trim();
    if (!name || seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    const url = careersIndex >= 0 ? String(row[careersIndex] || "").trim() : "";
    return [{ position: index + 1, name, url: url || null }];
  });
}

export function activateExcel(fileId) {
  const rows = db.prepare(
    "SELECT position,name,url FROM excel_companies WHERE file_id=? ORDER BY position"
  ).all(fileId);
  if (!rows.length) throw new Error("This Excel file has no companies");

  db.transaction(() => {
    db.prepare("UPDATE companies SET enabled=0").run();
    const upsert = db.prepare(
      "INSERT INTO companies(name,url,position,enabled) VALUES(?,?,?,1) " +
      "ON CONFLICT(name) DO UPDATE SET url=excluded.url,position=excluded.position,enabled=1"
    );
    for (const row of rows) upsert.run(row.name, row.url, row.position);
    setSetting("config", { ...config(), selectedExcelId: Number(fileId) });
  })();
}

export function importExcelFile(buffer, filename, { activate = true } = {}) {
  const companies = parseExcelCompanies(buffer);
  if (!companies.length) throw new Error("No company names were found");

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const directory = path.resolve("data/excel");
  fs.mkdirSync(directory, { recursive: true });
  const extension = path.extname(filename).toLowerCase() || ".xlsx";
  const filePath = path.join(directory, hash + extension);
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });

  let fileId;
  db.transaction(() => {
    db.prepare(
      "INSERT INTO excel_files(filename,path,hash,company_count) VALUES(?,?,?,?) " +
      "ON CONFLICT(hash) DO UPDATE SET filename=excluded.filename,company_count=excluded.company_count"
    ).run(filename, filePath, hash, companies.length);
    const file = db.prepare("SELECT id FROM excel_files WHERE hash=?").get(hash);
    fileId = file.id;
    db.prepare("DELETE FROM excel_companies WHERE file_id=?").run(fileId);
    const insert = db.prepare(
      "INSERT INTO excel_companies(file_id,position,name,url) VALUES(?,?,?,?)"
    );
    for (const company of companies) {
      insert.run(fileId, company.position, company.name, company.url);
    }
  })();

  if (activate) activateExcel(fileId);
  return db.prepare(
    "SELECT id,filename,company_count,uploaded_at FROM excel_files WHERE id=?"
  ).get(fileId);
}

export function listExcelFiles() {
  return db.prepare(
    "SELECT id,filename,company_count,uploaded_at FROM excel_files ORDER BY uploaded_at DESC,id DESC"
  ).all();
}
