/**
 * Where the queue's integration tests connect.
 *
 * They exercise real SQL — `FOR UPDATE SKIP LOCKED`, `ON CONFLICT`, `NOW()` as
 * the only clock — so a mock would prove nothing and they need a live Postgres.
 * What they must never do is run against the development database: `claimJob`
 * takes the globally oldest runnable job, so a stray dev job would be claimed,
 * mutated, and completed by the test suite.
 *
 * Hence a dedicated database, `<name>_test`, derived from `DATABASE_URL` unless
 * `TEST_DATABASE_URL` says otherwise. Both this module and the suite refuse any
 * name that does not end in `_test`.
 */

export const TEST_DB_SUFFIX = "_test";

export function testDatabaseUrl(): string | null {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL?.trim();
  if (!base) return null;

  const url = new URL(base);
  const name = databaseNameOf(url.toString());
  if (name.endsWith(TEST_DB_SUFFIX)) return url.toString();

  url.pathname = `/${name}${TEST_DB_SUFFIX}`;
  return url.toString();
}

export function databaseNameOf(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

/**
 * Throws unless the connection string points at something clearly disposable.
 * The guard is deliberately dumb and deliberately loud: everything downstream
 * of it truncates tables.
 */
export function assertDisposable(connectionString: string): void {
  const name = databaseNameOf(connectionString);
  if (!name.endsWith(TEST_DB_SUFFIX)) {
    throw new Error(
      `Refusing to use database "${name}" for tests: the name must end in "${TEST_DB_SUFFIX}". ` +
        `Set TEST_DATABASE_URL to a throwaway database.`,
    );
  }
}
