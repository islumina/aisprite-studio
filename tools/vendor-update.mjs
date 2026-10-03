#!/usr/bin/env node
// Vendor the editor's runtime packages into webeditor/vendor, from node_modules
// at the exact versions package.json pins (npm ci installs them).
//
//   node tools/vendor-update.mjs [--package <name>]  replace each package's vendored files wholesale
//   node tools/vendor-update.mjs --check             fail unless webeditor/vendor holds exactly the files,
//                                                    byte for byte, that an update would write
//
// Sources are always node_modules, never a sibling checkout's dist/ (gitignored,
// possibly stale). To vendor an unreleased build, install it first, e.g.
// `npm install --no-save ../aispritejs`, so node_modules carries that build.

import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TOOLS_DIRECTORY, "..");
const NODE_MODULES = path.join(PROJECT_ROOT, "node_modules");
const VENDOR_DIRECTORY = path.join(PROJECT_ROOT, "webeditor", "vendor");

// vendor/<name>/ mirrors the package's dist/*.js and dist/*.d.ts, plus its package.json.
const DIST_PACKAGES = ["aibridgejs", "aieventjs", "aispritejs"];
// Single files copied from a package to vendor/<target>.
const SINGLE_FILES = [{ name: "pixi.js", source: "dist/pixi.min.mjs", target: "pixi.min.mjs" }];
// Top-level vendor/ entries this script does not manage (vendored by hand).
const UNMANAGED = new Set(["fonts", "lucide-license.txt"]);

export const PACKAGES = [...DIST_PACKAGES, ...SINGLE_FILES.map((file) => file.name)];

const manifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));

function pinnedVersion(packageName) {
  const version = manifest.dependencies?.[packageName];
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${packageName} must have an exact version in package.json dependencies`);
  }
  return version;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Every file under `directory`, as posix paths relative to it. */
async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/** The installed package root, after checking it is the pinned version. */
async function packageRoot(packageName, nodeModules) {
  const root = path.join(nodeModules, packageName);
  const expected = pinnedVersion(packageName);
  let installed;
  try {
    installed = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
  } catch {
    throw new Error(`${packageName} is not installed in node_modules; run npm ci`);
  }
  if (installed !== expected) {
    throw new Error(`node_modules/${packageName} is ${installed}, package.json pins ${expected}; run npm ci`);
  }
  return root;
}

/**
 * What an update writes: vendor-relative posix path → absolute source file.
 * @param {string[]} packages
 * @param {string} nodeModules
 */
async function expectedFiles(packages, nodeModules) {
  const files = new Map();
  for (const packageName of packages) {
    const root = await packageRoot(packageName, nodeModules);
    if (DIST_PACKAGES.includes(packageName)) {
      const dist = path.join(root, "dist");
      for (const relative of await listFiles(dist)) {
        if (relative.endsWith(".js") || relative.endsWith(".d.ts")) files.set(`${packageName}/${relative}`, path.join(dist, relative));
      }
      files.set(`${packageName}/package.json`, path.join(root, "package.json"));
    } else {
      const single = SINGLE_FILES.find((file) => file.name === packageName);
      files.set(single.target, path.join(root, single.source));
    }
  }
  return files;
}

/** Managed files currently in the vendor directory. */
async function vendoredFiles(vendorDirectory) {
  const files = new Set();
  for (const packageName of DIST_PACKAGES) {
    const directory = path.join(vendorDirectory, packageName);
    if (await exists(directory)) for (const relative of await listFiles(directory)) files.add(`${packageName}/${relative}`);
  }
  for (const { target } of SINGLE_FILES) if (await exists(path.join(vendorDirectory, target))) files.add(target);
  return files;
}

/** Import-map targets in the editor page next to the vendor directory, if there is one. */
async function importMapTargets(vendorDirectory) {
  const page = path.join(vendorDirectory, "..", "index.html");
  if (!await exists(page)) return [];
  const html = await readFile(page, "utf8");
  const json = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  if (!json) return [];
  return Object.values(JSON.parse(json).imports ?? {}).map((target) => path.resolve(path.dirname(page), target));
}

export async function checkVendor(vendorDirectory = VENDOR_DIRECTORY, nodeModules = NODE_MODULES) {
  const expected = await expectedFiles(PACKAGES, nodeModules);
  const actual = await vendoredFiles(vendorDirectory);
  const problems = [];
  const managed = new Set([...DIST_PACKAGES, ...SINGLE_FILES.map((file) => file.target)]);
  for (const entry of await readdir(vendorDirectory)) {
    if (!managed.has(entry) && !UNMANAGED.has(entry) && entry !== ".DS_Store") problems.push(`unexpected vendor/${entry} (no package manages it)`);
  }
  for (const relative of [...actual].sort()) {
    if (!expected.has(relative)) problems.push(`stale vendor/${relative}`);
  }
  for (const [relative, source] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
    if (!actual.has(relative)) {
      problems.push(`missing vendor/${relative}`);
    } else if (!(await readFile(source)).equals(await readFile(path.join(vendorDirectory, relative)))) {
      problems.push(`vendor/${relative} differs from ${path.relative(PROJECT_ROOT, source)}`);
    }
  }
  for (const target of await importMapTargets(vendorDirectory)) {
    if (!await exists(target)) problems.push(`import map target ${path.relative(PROJECT_ROOT, target)} does not exist`);
  }
  if (problems.length > 0) {
    throw new Error(`webeditor/vendor does not match the pinned packages (npm run vendor:update):\n  ${problems.join("\n  ")}`);
  }
  return { packages: PACKAGES.length, files: expected.size };
}

export async function updateVendor({
  vendorDirectory = VENDOR_DIRECTORY,
  nodeModules = NODE_MODULES,
  packages = PACKAGES,
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const expected = await expectedFiles(packages, nodeModules); // validates every package before touching vendor/
  await mkdir(vendorDirectory, { recursive: true });
  for (const packageName of packages) {
    log(`Updating ${packageName} ${pinnedVersion(packageName)}...`);
    // Replace wholesale, so files the new version no longer ships do not linger.
    if (DIST_PACKAGES.includes(packageName)) await rm(path.join(vendorDirectory, packageName), { recursive: true, force: true });
  }
  for (const [relative, source] of expected) {
    const destination = path.join(vendorDirectory, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  return checkVendor(vendorDirectory, nodeModules);
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(`Usage: node tools/vendor-update.mjs [--check] [--package <${PACKAGES.join("|")}>]\n`);
    return;
  }
  const packageIndex = process.argv.indexOf("--package");
  const selectedPackage = packageIndex >= 0 ? process.argv[packageIndex + 1] : undefined;
  if (packageIndex >= 0 && !PACKAGES.includes(selectedPackage)) {
    throw new Error(`--package must be one of: ${PACKAGES.join(", ")}`);
  }
  const check = process.argv.includes("--check");
  const result = check
    ? await checkVendor()
    : await updateVendor({ packages: selectedPackage ? [selectedPackage] : PACKAGES });
  process.stdout.write(`Vendor ${check ? "check" : "update"} complete (${result.packages} packages, ${result.files} files).\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
