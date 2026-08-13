import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  // Used by the migrate/studio CLI. The runtime client connects through the
  // driver adapter in src/lib/db.ts instead.
  datasource: { url: env("DATABASE_URL") },
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
