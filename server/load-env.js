// F171: dependency-free .env loader (CommonJS, no npm packages).
// Reads KEY=VALUE lines from <rootDir>/.env into process.env.
//
// Guarantees:
//   - keys already present in process.env are never overwritten
//     (real process env / pm2 env always beats the file);
//   - missing or unreadable file is not an error (silent no-op);
//   - key values are never logged or returned;
//   - requiring this module has no side effects — call loadEnv().
//
// Returns the number of keys actually set.

const fs = require("fs");
const path = require("path");

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const normalized = trimmed.replace(/^export\s+/, "");
  const eq = normalized.indexOf("=");
  if (eq <= 0) return null;
  const key = normalized.slice(0, eq).trim();
  if (!key) return null;
  let value = normalized.slice(eq + 1).trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1);
    }
  }
  return [key, value];
}

function loadEnv(rootDir = path.join(__dirname, "..")) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(rootDir, ".env"), "utf8");
  } catch {
    return 0;
  }
  let loaded = 0;
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded += 1;
  }
  return loaded;
}

module.exports = { loadEnv };
