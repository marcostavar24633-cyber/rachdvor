import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, extname, normalize, sep } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { isAllowedCatalogImage } from "../functions/api/catalog.js";

assert.equal(isAllowedCatalogImage("assets/raki/hero.png"), true);
assert.equal(isAllowedCatalogImage("https://cdn.example.com/image.jpg"), true);
assert.equal(isAllowedCatalogImage(""), true);
for (const unsafe of ["../secret.png", "assets/../secret.png", "assets/raki/../../secret.png", "/assets/raki/hero.png", "//evil.example/image.png", "javascript:alert(1)", "data:image/png;base64,AA=="]) {
  assert.equal(isAllowedCatalogImage(unsafe), false, `Unsafe catalog image path accepted: ${unsafe}`);
}

const root = process.cwd();
const errors = [];
const checked = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function checkJavaScript(source, label) {
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: source,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    errors.push(`${label}:\n${result.stderr || result.stdout}`);
  } else {
    checked.push(label);
  }
}

const files = await walk(root);
const fileSet = new Set(files.map(file => file.slice(root.length + 1)));
for (const file of files) {
  const relative = file.slice(root.length + 1);
  const ext = extname(file).toLowerCase();
  const source = await readFile(file, "utf8");

  if (ext === ".html") {
    for (const match of source.matchAll(/\\b(?:src|href)\\s*=\\s*(["'])(.*?)\\1/gi)) {
      await verifyLocalReference(match[2], relative);
    }
    for (const match of source.matchAll(/url\\(\\s*(["']?)(.*?)\\1\\s*\\)/gi)) {
      await verifyLocalReference(match[2], relative);
    }
  }

  if (ext === ".json") {
    try {
      JSON.parse(source);
      checked.push(relative + " (JSON)");
    } catch (error) {
      errors.push(`${relative}: invalid JSON: ${error.message}`);
    }
  }

  if (ext === ".js" && (relative.startsWith("functions/") || relative.startsWith("scripts/"))) {
    checkJavaScript(source, relative);
  }

  if (ext === ".html") {
    const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    let inlineIndex = 0;
    for (const match of scripts) {
      const attrs = match[1] || "";
      if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["'](?:application\/ld\+json|importmap)["']/i.test(attrs)) continue;
      const body = match[2].trim();
      if (!body) continue;
      inlineIndex += 1;
      checkJavaScript(body, `${relative} inline script #${inlineIndex}`);
    }
    checked.push(relative + " (HTML scripts scanned)");
  }
}

if (errors.length) {
  console.error("Validation failed:\n\n" + errors.join("\n\n"));
  process.exit(1);
}
console.log(`Validation passed: ${checked.length} checks completed.\n` + checked.join("\n"));
