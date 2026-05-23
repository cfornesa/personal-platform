import app from "./app";
import { logger } from "./lib/logger";
import { ensureTables } from "@workspace/db";
import { backfillMediaAssetsFromFilesystem } from "./lib/media";
import { backfillPostContentText } from "./lib/html";
import { startPostScheduler } from "./lib/post-scheduler";

const rawPort = process.env["PORT"] ?? "5000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

ensureTables()
  .then(() => backfillPostContentText())
  .then(() => backfillMediaAssetsFromFilesystem())
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startPostScheduler();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to initialize database tables");
    process.exit(1);
  });
