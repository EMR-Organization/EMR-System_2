import { config } from "dotenv";

// Optional .env.test.local points tests at a separate database (e.g. emr_test),
// so test runs don't fill your dev database. Loaded first, so it wins.
config({ path: ".env.test.local", quiet: true });
config({ path: ".env.local", quiet: true });
config({ quiet: true });
