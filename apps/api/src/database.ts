import { Pool } from "pg";

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
}
