import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const defaultWrangler = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
const wrangler = process.env.WRANGLER_BIN || defaultWrangler;
const databaseName =
  process.env.FAIRTURN_D1_DATABASE_NAME?.trim() || "fairturn-db";

function runWrangler(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(wrangler, args, {
      cwd: projectRoot,
      env: { ...process.env, CI: process.env.CI || "true" },
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });

    let stdout = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Wrangler exited with status ${code}.`));
    });
  });
}

function parseDatabaseList(output) {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Wrangler did not return a valid D1 database list.");
  }
}

const listOutput = await runWrangler(["d1", "list", "--json"], {
  capture: true,
});
const databases = parseDatabaseList(listOutput);
const database = databases.find((candidate) => candidate.name === databaseName);
const databaseId = database?.uuid ?? database?.id ?? database?.database_id;

if (!databaseId) {
  throw new Error(
    `Cloudflare D1 database '${databaseName}' was not found after deployment.`,
  );
}

const temporaryConfigPath = path.join(
  projectRoot,
  `.wrangler.migrations.${process.pid}.jsonc`,
);
const temporaryConfig = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: "fairturn-d1-migrations",
  compatibility_date: "2026-08-24",
  d1_databases: [
    {
      binding: "DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "drizzle",
    },
  ],
};

try {
  await writeFile(
    temporaryConfigPath,
    `${JSON.stringify(temporaryConfig, null, 2)}\n`,
    { flag: "wx" },
  );
  console.log(`Applying migrations to Cloudflare D1 '${databaseName}'...`);
  await runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    temporaryConfigPath,
  ]);
} finally {
  await rm(temporaryConfigPath, { force: true });
}
