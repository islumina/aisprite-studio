#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TOOLS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TOOLS_DIRECTORY, "..");
const SOURCE_ROOT = path.resolve(PROJECT_ROOT, "..");
const VENDOR_DIRECTORY = path.join(PROJECT_ROOT, "webeditor", "vendor");
const PACKAGES = ["aibridgejs", "aieventjs", "aipooljs", "aifsmjs", "aispritejs"];
const REQUIRED_FILES = [
  "aibridgejs/index.js",
  "aibridgejs/iframe/index.js",
  "aispritejs/index.js",
  "aispritejs/atlas/index.js",
  "aispritejs/pixi/index.js",
];

const manifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));

function pinnedVersion(packageName) {
  const version = manifest.dependencies?.[packageName];
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`${packageName} must have an exact version in package.json dependencies`);
  }
  return version;
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function copyDistribution(source, destination) {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: true });
      await copyDistribution(sourcePath, destinationPath);
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await cp(sourcePath, destinationPath);
    }
  }
}

async function resolvePackageRoot(packageName, stageDirectory, allowVersionMismatch) {
  const expectedVersion = pinnedVersion(packageName);
  const localRoot = path.join(SOURCE_ROOT, packageName);
  if (await isFile(path.join(localRoot, "package.json")) && await isFile(path.join(localRoot, "dist", "index.js"))) {
    const localManifest = JSON.parse(await readFile(path.join(localRoot, "package.json"), "utf8"));
    if (localManifest.version !== expectedVersion && !allowVersionMismatch) {
      throw new Error(`${packageName} local version ${localManifest.version} does not match pinned ${expectedVersion}; pass --allow-version-mismatch only for an intentional upgrade`);
    }
    process.stdout.write(`  source: ${localRoot}\n`);
    return localRoot;
  }

  const packageDirectory = path.join(stageDirectory, `package-${packageName}`);
  await mkdir(packageDirectory, { recursive: true });
  const { stdout } = await execFileAsync("npm", ["pack", `${packageName}@${expectedVersion}`, "--json"], {
    cwd: packageDirectory,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  let filename;
  try {
    const result = JSON.parse(stdout);
    filename = result[0]?.filename;
  } catch {
    throw new Error(`npm pack returned invalid JSON for ${packageName}`);
  }
  if (typeof filename !== "string" || path.basename(filename) !== filename) {
    throw new Error(`npm pack returned an unsafe filename for ${packageName}`);
  }
  await execFileAsync("tar", ["-xzf", filename], {
    cwd: packageDirectory,
    timeout: 30_000,
    maxBuffer: 512 * 1024,
  });
  process.stdout.write(`  source: npm ${expectedVersion}\n`);
  return path.join(packageDirectory, "package");
}

export async function checkVendor(vendorDirectory = VENDOR_DIRECTORY) {
  const missing = [];
  for (const relativePath of REQUIRED_FILES) {
    if (!await isFile(path.join(vendorDirectory, relativePath))) missing.push(relativePath);
  }
  for (const packageName of PACKAGES) {
    try {
      const vendoredManifest = JSON.parse(await readFile(path.join(vendorDirectory, packageName, "package.json"), "utf8"));
      if (vendoredManifest.version !== pinnedVersion(packageName)) {
        throw new Error(`${packageName} is ${vendoredManifest.version}, expected ${pinnedVersion(packageName)}`);
      }
    } catch (error) {
      throw new Error(`Invalid vendored ${packageName}/package.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (missing.length > 0) throw new Error(`Missing vendored files: ${missing.join(", ")}`);
  return { packages: PACKAGES.length, requiredFiles: REQUIRED_FILES.length };
}

export async function updateVendor({
  vendorDirectory = VENDOR_DIRECTORY,
  packages = PACKAGES,
  allowVersionMismatch = false,
} = {}) {
  await mkdir(vendorDirectory, { recursive: true });
  const stageDirectory = await mkdtemp(path.join(os.tmpdir(), "aisprite-studio-vendor-"));
  try {
    for (const packageName of packages) {
      process.stdout.write(`Updating ${packageName}...\n`);
      const packageRoot = await resolvePackageRoot(packageName, stageDirectory, allowVersionMismatch);
      const outputDirectory = path.join(stageDirectory, `output-${packageName}`);
      await mkdir(outputDirectory, { recursive: true });
      await copyDistribution(path.join(packageRoot, "dist"), outputDirectory);
      await writeFile(
        path.join(outputDirectory, "package.json"),
        await readFile(path.join(packageRoot, "package.json")),
      );
    }

    // Preserve the previous script's non-destructive overlay behaviour. A later
    // cleanup can remove stale chunks after release artefacts are inventoried.
    for (const packageName of packages) {
      await mkdir(path.join(vendorDirectory, packageName), { recursive: true });
      await cp(path.join(stageDirectory, `output-${packageName}`), path.join(vendorDirectory, packageName), {
        recursive: true,
        force: true,
      });
    }
    return await checkVendor(vendorDirectory);
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write("Usage: node tools/vendor-update.mjs [--check] [--package <ai*js>] [--allow-version-mismatch]\n");
    return;
  }
  const packageIndex = process.argv.indexOf("--package");
  const selectedPackage = packageIndex >= 0 ? process.argv[packageIndex + 1] : undefined;
  if (packageIndex >= 0 && !PACKAGES.includes(selectedPackage)) {
    throw new Error(`--package must be one of: ${PACKAGES.join(", ")}`);
  }
  const result = process.argv.includes("--check")
    ? await checkVendor()
    : await updateVendor({
      packages: selectedPackage ? [selectedPackage] : PACKAGES,
      allowVersionMismatch: process.argv.includes("--allow-version-mismatch"),
    });
  process.stdout.write(`Vendor ${process.argv.includes("--check") ? "check" : "update"} complete (${result.packages} packages).\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
