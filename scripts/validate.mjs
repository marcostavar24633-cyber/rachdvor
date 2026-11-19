import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { spawnSync } from "node:child_process";

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
for (const file of files) {
  const relative = file.slice(root.length + 1);
  const ext = extname(file).toLowerCase();
  const source = await readFile(file, "utf8");

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
