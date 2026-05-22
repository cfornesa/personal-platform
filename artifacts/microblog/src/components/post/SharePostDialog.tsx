import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { 
  Twitter, 
  Linkedin, 
  Facebook, 
  MessageCircle, 
  Copy, 
  Share2 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Post } from "@workspace/api-client-react";

interface SharePostDialogProps {
  post: Post;
  children: React.ReactNode;
}

export function SharePostDialog({ post, children }: SharePostDialogProps) {
  const { toast } = useToast();
  
  const shareUrl = `${window.location.origin}/posts/${post.id}`;
  
  // Clean text: strip HTML and truncate
  const plainText = post.contentFormat === 'html' 
    ? post.content.replace(/<[^>]*>?/gm, '') 
    : post.content;
  const snippet = plainText.substring(0, 160) + (plainText.length > 160 ? "..." : "");
  
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(snippet);

  const shareOptions = [
    {
      name: "X (Twitter)",
      icon: Twitter,
      color: "bg-black text-white hover:bg-black/90",
      url: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    },
    {
      name: "Bluesky",
      icon: Share2, // Bluesky doesn't have a direct Lucide icon, using Share2 as fallback/close match
      color: "bg-[#0560ff] text-white hover:bg-[#0560ff]/90",
      url: `https://bsky.app/intent/compose?text=${encodedText}%20${encodedUrl}`,
    },
    {
      name: "LinkedIn",
      icon: Linkedin,
      color: "bg-[#0077b5] text-white hover:bg-[#0077b5]/90",
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
    {
      name: "Facebook",
      icon: Facebook,
      color: "bg-[#1877f2] text-white hover:bg-[#1877f2]/90",
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      name: "Message",
      icon: MessageCircle,
      color: "bg-[#25d366] text-white hover:bg-[#25d366]/90",
      url: `sms:?&body=${encodedText}%20${encodedUrl}`,
    },
  ];

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      toast({ 
        title: "Link copied", 
        description: "Post URL is ready to paste." 
      });
    }).catch(() => {
      toast({ 
        title: "Failed to copy", 
        description: "Please copy the URL manually.",
        variant: "destructive"
      });
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-[6px] border-black rounded-none shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-0 gap-0 overflow-hidden [&>button]:text-white [&>button]:opacity-100 [&>button]:top-6 [&>button]:right-6 [&>button]:hover:bg-white/10 [&>button]:border-2 [&>button]:border-white [&>button]:rounded-none">
        <DialogHeader className="p-6 bg-black text-white border-b-[6px] border-black rounded-none pr-16">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter flex items-center gap-2">
            <Share2 className="h-6 w-6 text-yellow-400" />
            Share Post
          </DialogTitle>
        </DialogHeader>

        {post.featuredImageUrl && (
          <div className="relative h-32 w-full overflow-hidden border-b-[4px] border-black">
            <img
              src={post.featuredImageUrl}
              alt="Featured"
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="p-6 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {shareOptions.map((option) => (
              <Button
                key={option.name}
                variant="outline"
                className={`flex items-center justify-start gap-3 h-14 px-4 ${option.color} border-[4px] border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all active:translate-x-[4px] active:translate-y-[4px] active:shadow-none`}
                onClick={() => window.open(option.url, "_blank")}
              >
                <div className="bg-white/20 p-1.5 border-2 border-current">
                  <option.icon className="h-5 w-5" />
                </div>
                <span className="font-black uppercase tracking-tight text-sm">{option.name}</span>
              </Button>
            ))}
            
            <Button
              variant="outline"
              className="flex items-center justify-start gap-3 h-14 px-4 bg-yellow-400 text-black hover:bg-yellow-500 border-[4px] border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all active:translate-x-[4px] active:translate-y-[4px] active:shadow-none col-span-1 sm:col-span-2 mt-2"
              onClick={handleCopyLink}
            >
              <div className="bg-black/10 p-1.5 border-2 border-black">
                <Copy className="h-5 w-5" />
              </div>
              <span className="font-black uppercase tracking-tight text-sm">Copy Direct Link</span>
            </Button>
          </div>
        </div>
        
        <div className="bg-black p-3 text-center">
          <span className="text-[10px] text-white/50 font-bold uppercase tracking-[0.2em]">CreatrWeb Social Intent Engine</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
