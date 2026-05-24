import type { ReactNode } from "react";
import { Box } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

type ImmersiveMediaFrameProps = {
  href: string;
  label: string;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
};

export function ImmersiveMediaFrame({
  href,
  label,
  children,
  className,
  buttonClassName,
}: ImmersiveMediaFrameProps) {
  return (
    <div className={cn("group/immersive relative", className)}>
      {children}
      <Link
        href={href}
        className={cn(
          "absolute bottom-3 right-3 z-20 inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-border/70 bg-background/90 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-foreground shadow-lg backdrop-blur transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          buttonClassName,
        )}
      >
        <Box className="mr-1.5 h-4 w-4" />
        <span>VR</span>
        <span className="sr-only">{label}</span>
      </Link>
    </div>
  );
}
