import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

// Load workspace root env variables for tests
const rootDotEnv = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(rootDotEnv)) {
  const content = fs.readFileSync(rootDotEnv, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  }
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@workspace/db": new URL("../../lib/db/src/index.ts", import.meta.url).pathname,
    },
  },
});
