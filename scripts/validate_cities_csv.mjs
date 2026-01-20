import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSV_PATH = path.join(ROOT, "cidades_area_atendida_1a_home_energy.csv");

// Cidades que nunca podem estar na lista
const BLOCKLIST = new Set([
  "MILTON",
  "PHILLIPSTON",
  "EVERETT",
  "CAMBRIDGE",
  "NEWTON",
]);

function die(msg) {
  console.error(`\n[validate_cities_csv] ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(CSV_PATH)) {
  die(`Arquivo não encontrado: ${CSV_PATH}`);
}

const raw = fs.readFileSync(CSV_PATH, "utf8").replace(/\r\n/g, "\n");
const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

if (lines.length === 0) die("CSV vazio.");

const header = lines[0].toUpperCase();
if (header !== "NAME") {
  die(`Header inválido. Esperado: "NAME". Encontrado: "${lines[0]}".`);
}

const cities = lines.slice(1).map((c) => c.trim()).filter(Boolean);

if (cities.length === 0) die("Nenhuma cidade encontrada após o header NAME.");

const normalized = cities.map((c) => c.toUpperCase());
const uniq = new Set(normalized);

if (uniq.size !== normalized.length) {
  // encontra duplicadas
  const seen = new Set();
  const dups = [];
  for (const c of normalized) {
    if (seen.has(c)) dups.push(c);
    seen.add(c);
  }
  die(`Há cidades duplicadas no CSV: ${Array.from(new Set(dups)).join(", ")}`);
}

const blocked = normalized.filter((c) => BLOCKLIST.has(c));
if (blocked.length > 0) {
  die(`Cidades bloqueadas presentes no CSV: ${Array.from(new Set(blocked)).join(", ")}`);
}

console.log(`[validate_cities_csv] OK — ${cities.length} cidades, header NAME, sem duplicadas, sem blocklist.`);
