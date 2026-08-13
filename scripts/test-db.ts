import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import {
  assertDisposable,
  databaseNameOf,
  testDatabaseUrl,
} from "./test-database-url";

/**
 * Creates the queue tests' database and brings it up to the current migration.
 *
 * Idempotent — run it once, and again after any migration. `npm test` skips the
 * integration suite entirely when this has not been run, so the unit tests stay
 * runnable on a machine with no Postgres at all.
 */

async function main() {
  const url = testDatabaseUrl();
  if (!url) {
    throw new Error(
      "Neither TEST_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env.",
    );
  }
  assertDisposable(url);

  const name = databaseNameOf(url);
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";

  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (existing.rowCount === 0) {
      // The name is validated above and comes from the operator's own
      // connection string, but it still cannot be parameterised in DDL.
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`created database ${name}`);
    } else {
      console.log(`database ${name} already exists`);
    }
  } finally {
    await client.end();
  }

  // prisma.config.ts prefers DIRECT_DATABASE_URL, so both have to point here.
  // `npx` is a .cmd on Windows, which execFile can only launch by name — hence
  // the explicit extension rather than `shell: true`, which would splice the
  // arguments into a command line unescaped.
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
    "prisma",
    "migrate",
    "deploy",
  ], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
