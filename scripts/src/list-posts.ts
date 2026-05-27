import { db, ensureTables, postsTable, desc } from "@workspace/db";

async function main() {
  await ensureTables();
  const posts = await db
    .select({ 
      id: postsTable.id, 
      title: postsTable.title, 
      content: postsTable.content, 
      authorName: postsTable.authorName, 
      createdAt: postsTable.createdAt 
    })
    .from(postsTable)
    .orderBy(desc(postsTable.createdAt))
    .limit(10);

  if (posts.length === 0) {
    console.log("No posts found.");
    return;
  }

  for (const post of posts) {
    console.log(
      [
        `id=${post.id}`,
        `createdAt=${post.createdAt}`,
        `author=${post.authorName ?? "anonymous"}`,
        `title=${post.title ?? "(no title)"}`,
        `contentPreview=${post.content.slice(0, 50)}...`,
      ].join(" | "),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
