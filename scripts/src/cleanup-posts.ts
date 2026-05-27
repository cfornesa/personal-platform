import { db, ensureTables, postsTable, inArray } from "@workspace/db";

async function main() {
  await ensureTables();
  const idsToDelete = [176, 154, 132, 110, 88];
  
  console.log(`Attempting to delete posts with IDs: ${idsToDelete.join(", ")}`);
  
  const result = await db.delete(postsTable).where(inArray(postsTable.id, idsToDelete));
  
  console.log("Delete operation completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
