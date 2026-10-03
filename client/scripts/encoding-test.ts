// Guard against mojibake in the source files the student actually reads.
//
// Run: npm run test:encoding
//
// The origin: dashboard.ts was committed with every non-ASCII character in it
// double-encoded. An em-dash had been written to the file as the three Windows-1252
// characters that are what you get when UTF-8 bytes are read as latin-1 -- so the
// dashboard rendered "Moving fast â€" and "this topic Â· Getting there" to real
// users, in plain sight, for the life of the project.
//
// It survived because nothing looks at source files, and because the test suites
// check behaviour rather than text. It was only found by taking a screenshot of
// the running app and actually reading it, which is the argument for this file
// existing: some defects are only visible when you look at the product.
//
// This scans the tracked text files for byte sequences that are the *signature*
// of that mistake -- the ASCII rendering of a mis-decoded em-dash, curly quote,
// ellipsis or middle dot -- and fails if it finds any. It deliberately does not
// ban non-ASCII: Hindi, the owl's Devanagari, and the emoji in the README are all
// supposed to be there.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const results: Array<{ label: string; ok: boolean }> = [];
function check(label: string, ok: boolean, detail = ""): void {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Each entry is [pattern, what it stands for]. These are the literal
// mis-decoded forms, written as escapes so this file cannot itself be
// corrupted by the same editor mishap that caused the original bug.
const MOJIBAKE: Array<[RegExp, string]> = [
  [/\u00e2\u20ac\u201d|\u00e2\u20ac\u201c|\u00e2\u20ac\u0093/u, "em dash"],
  [/\u00e2\u20ac\u2122/u, "right single quote"],
  [/\u00e2\u20ac\u0153/u, "left double quote"],
  [/\u00e2\u20ac\u009d/u, "right double quote"],
  [/\u00e2\u20ac\u00a6/u, "ellipsis"],
  [/\u00c2\u00b7/u, "middle dot"],
  [/\u00c3\u00a9|\u00c3\u00a8/u, "accented latin letter"],
];

const SKIP = new Set(["node_modules", "dist", ".git", "docs"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|css|html|json|md)$/.test(entry)) out.push(full);
  }
  return out;
}

// Read the tracked file list rather than crawling the tree: it keeps generated
// output and editor scratch files out by construction.
// This file is excluded from the scan. It has to name the mojibake sequences
// in order to search for them, so it necessarily contains them -- a test that
// fails on its own pattern table is a test that can never pass.
const SELF = fileURLToPath(import.meta.url).replace(/\\/g, "/");

const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && /\.(ts|tsx|mjs|js|css|html|json|md)$/.test(f))
  .filter((f) => !f.replace(/\\/g, "/").endsWith(SELF.split("/").slice(-2).join("/")));

const scanned = walk(ROOT).length;
check("git can list the tracked files", tracked.length > 0, `${tracked.length} text files`);

let offenders = 0;
for (const rel of tracked) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const [pattern, name] of MOJIBAKE) {
      if (pattern.test(line)) {
        offenders += 1;
        console.log(`      ${rel}:${index + 1}  (${name})`);
        console.log(`        ${line.trim().slice(0, 100)}`);
      }
    }
  });
}

check(
  "no mis-decoded characters in tracked source",
  offenders === 0,
  offenders === 0 ? `${tracked.length} files scanned` : `${offenders} found`,
);

// The files a student reads, named explicitly. These are the ones where a
// corrupted em-dash is a visible product defect rather than a cosmetic detail
// in a comment, so a regression there is worth naming even if the general scan
// were somehow satisfied.
const STUDENT_FACING = [
  "client/src/components/dashboard.ts",
  "client/src/components/alerts.ts",
  "client/src/main.ts",
];

for (const rel of STUDENT_FACING) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const bad = MOJIBAKE.filter(([pattern]) => pattern.test(text)).length;
  check(`${rel} renders its punctuation correctly`, bad === 0);
}

// A real em-dash must still be possible. If someone "fixes" this by stripping
// every non-ASCII byte, Hindi and the owl break and this catches it.
const dash = readFileSync(join(ROOT, "client/src/components/dashboard.ts"), "utf8");
check(
  "the repair produced real characters, not deletions",
  dash.includes("\u2014") && dash.includes("\u2026"),
  `em-dash present: ${dash.includes("\u2014")}, ellipsis: ${dash.includes("\u2026")}`,
);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);