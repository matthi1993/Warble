import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAX_LINES = 300;
const SOURCE_ROOTS = ["app/src", "app/tests", "packages"];
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist"]);

const RULES = [
  {
    message: "packages must not import lit",
    applies: (file) => file.startsWith("packages/"),
    pattern: /from\s+["']lit(\/[^"']*)?["']/,
  },
  {
    message: "packages must not import Tauri",
    applies: (file) => file.startsWith("packages/"),
    pattern: /from\s+["']@tauri-apps\//,
  },
  {
    message: "Tauri may only be imported in app/src/platform",
    applies: (file) => file.startsWith("app/src/") && !file.startsWith("app/src/platform/"),
    pattern: /from\s+["']@tauri-apps\//,
  },
  {
    message: "state, platform and composition must not import lit",
    applies: (file) => /^app\/src\/(state|platform|composition)\//.test(file),
    pattern: /from\s+["']lit(\/[^"']*)?["']/,
  },
  {
    message: "controllers and models must not import lit",
    applies: (file) => /^app\/src\/.*-(controller|model)\.ts$/.test(file),
    pattern: /from\s+["']lit(\/[^"']*)?["']/,
  },
];

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (IGNORED_DIRECTORIES.has(name)) return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|css)$/.test(name) ? [path] : [];
  });
}

const problems = [];
for (const root of SOURCE_ROOTS) {
  for (const path of sourceFiles(join(ROOT, root))) {
    const file = relative(ROOT, path).split("\\").join("/");
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    if (lines > MAX_LINES) problems.push(`${file}: ${lines} lines (limit ${MAX_LINES})`);
    for (const rule of RULES) {
      if (rule.applies(file) && rule.pattern.test(text)) problems.push(`${file}: ${rule.message}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Structure check failed (${problems.length}):\n${problems.sort().join("\n")}`);
  process.exit(1);
}
console.log("Structure check passed");
