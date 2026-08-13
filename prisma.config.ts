import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  // Used by the migrate/studio CLI only; the app connects through the driver
  // adapter in src/lib/db.ts.
  //
  // Migrations want a session-mode connection: they run DDL and take advisory
  // locks, and neither survives a transaction pooler that hands the connection
  // back after every statement. So the CLI prefers DIRECT_DATABASE_URL when one
  // is set, falling back to DATABASE_URL locally, where both are the same
  // database.
  datasource: {
    url: process.env.DIRECT_DATABASE_URL?.trim() || env("DATABASE_URL"),
  },
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
