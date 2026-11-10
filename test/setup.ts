// Deterministic secrets for tests; DB tests use TEST_DATABASE_URL (local Postgres, see CONTRIBUTING.md).
process.env.CREDENTIALS_KEK ??= "v1:" + Buffer.alloc(32, 7).toString("base64");
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_URL ??= "http://localhost:3000";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://kolbaba:kolbaba@localhost:5432/kolbaba_test";
