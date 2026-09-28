import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reads the optional .env file in the project folder. Imported first by
// server/index.ts, so its values are in place before any setting is read.

const file = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), ".env");
if (existsSync(file)) {
  try {
    process.loadEnvFile(file);
  } catch {
    console.warn("  Couldn't read .env (check its format). Continuing with defaults.");
  }
}
