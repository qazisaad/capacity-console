import { readdir, readFile, access } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (entry.name.endsWith(".md")) result.push(path);
  }
  return result;
}
const failures = [];
let count = 0;
const files = await markdownFiles(root);
for (const path of files) {
  const content = await readFile(path, "utf8");
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
    const local = decodeURIComponent(target.split("#")[0]);
    if (local.startsWith("/")) {
      failures.push(`${relative(root, path)}: nonportable local link ${local}`);
      continue;
    }
    try { await access(resolve(dirname(path), local)); count++; }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      failures.push(`${relative(root, path)}: missing ${local}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`Checked ${files.length} Markdown files and ${count} local links. External links and future runtime behavior are not validated by this check.`);
