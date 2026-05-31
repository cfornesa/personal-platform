import { useRoute } from "wouter";
import { useGetPost, getGetPostQueryKey } from "@workspace/api-client-react";
import { PostContent } from "@/components/post/PostContent";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatPostDate } from "@/lib/format-date";

export default function PostEmbed() {
  const [, params] = useRoute("/embed/posts/:id");
  const postId = Number(params?.id);

  const { data: postData, isLoading, error } = useGetPost(postId, {
    query: { 
      queryKey: getGetPostQueryKey(postId),
      enabled: !isNaN(postId) && postId > 0 
    }
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse bg-card min-h-screen">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-muted"></div>
          <div className="space-y-2">
            <div className="h-4 w-24 bg-muted rounded"></div>
            <div className="h-3 w-16 bg-muted rounded"></div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-4 w-full bg-muted rounded"></div>
          <div className="h-4 w-2/3 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (isNaN(postId) || postId <= 0 || error || !postData) {
    return (
      <div className="p-8 text-center bg-card min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-xl font-bold mb-2">Post not found</h1>
        <p className="text-muted-foreground text-sm">The post you are looking for does not exist or has been removed.</p>
      </div>
    );
  }

  const { post } = postData;

  return (
    <div className="bg-card min-h-screen border border-border overflow-hidden">
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 border border-border">
            <AvatarImage src={post.authorImageUrl || undefined} alt={post.authorName} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium">
              {(post.authorName?.charAt(0) || "U").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-semibold text-foreground text-sm">
              {post.authorName}
            </span>
            <span className="text-muted-foreground text-xs">
              {formatPostDate(post.createdAt)}
            </span>
          </div>
        </div>

        <PostContent content={post.content} contentFormat={post.contentFormat} postId={post.id} />
        
        <div className="pt-2 flex items-center justify-between border-t border-border mt-4">
          <a 
            href={`/posts/${post.id}`} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors font-medium uppercase tracking-wider"
          >
            View on Microblog
          </a>
        </div>
      </div>
    </div>
  );
}
