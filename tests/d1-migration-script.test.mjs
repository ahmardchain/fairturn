import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);

function runMigrationScript(mockWrangler) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(projectRoot, "scripts", "migrate-d1-remote.mjs")],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          CI: "true",
          WRANGLER_BIN: mockWrangler,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("remote migration discovers the provisioned D1 ID before applying", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "fairturn-d1-test-"));
  const mockWrangler = path.join(directory, "wrangler.mjs");
  await writeFile(
    mockWrangler,
    `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (args.join(" ") === "d1 list --json") {
  console.log(JSON.stringify([{ name: "fairturn-db", uuid: "11111111-2222-4333-8444-555555555555" }]));
  process.exit(0);
}
const configIndex = args.indexOf("--config");
const config = JSON.parse(await readFile(args[configIndex + 1], "utf8"));
const binding = config.d1_databases[0];
if (
  args.slice(0, 5).join(" ") !== "d1 migrations apply DB --remote" ||
  binding.database_id !== "11111111-2222-4333-8444-555555555555" ||
  binding.migrations_dir !== "drizzle"
) process.exit(2);
console.log("mock migrations applied");
`,
  );
  await chmod(mockWrangler, 0o755);

  try {
    const result = await runMigrationScript(mockWrangler);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Applying migrations/);
    assert.match(result.stdout, /mock migrations applied/);
    const leftovers = (await readdir(projectRoot)).filter((name) =>
      name.startsWith(".wrangler.migrations."),
    );
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
