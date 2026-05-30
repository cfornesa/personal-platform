import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  useUpdateMe,
  useUploadProfilePhoto,
  getGetMeQueryKey,
  getGetUserQueryKey,
  getGetPostsByUserQueryKey,
  getListPostsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { UserPageCustomizationCard } from "@/components/layout/UserPageCustomizationCard";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getUploadErrorMessage } from "@/components/post/upload-error";
import { Camera, Globe, ImageIcon, Instagram, Youtube, Twitter, Music2, Tv, Github, Linkedin } from "lucide-react";

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/avif";

export default function SettingsPage() {
  const { currentUser, isLoading: isUserLoading } = useCurrentUser();
  const { data: siteSettings } = useSiteSettings();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [isImageLibraryOpen, setIsImageLibraryOpen] = useState(false);

  const invalidateProfileQueries = () => {
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    if (currentUser?.username) {
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(currentUser.username) });
    }
    if (currentUser?.id) {
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(currentUser.id) });
      queryClient.invalidateQueries({ queryKey: getGetPostsByUserQueryKey(currentUser.id) });
    }
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["listPosts"] });
  };

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.name || "");
      setUsername(currentUser.username || "");
      setBio(currentUser.bio || "");
      setWebsite(currentUser.website || "");
      setSocialLinks((currentUser.socialLinks as Record<string, string>) || {});
    }
  }, [currentUser]);

  const updateMe = useUpdateMe({
    mutation: {
      onSuccess: () => {
        invalidateProfileQueries();
        toast({ title: "Profile updated", description: "Your changes have been saved." });
      },
      onError: (error: any) => {
        const message = error?.response?.data?.error || "Failed to update profile";
        toast({ title: "Error", description: message, variant: "destructive" });
      },
    },
  });

  const uploadProfilePhoto = useUploadProfilePhoto({
    mutation: {
      onSuccess: () => {
        invalidateProfileQueries();
        toast({ title: "Profile photo updated", description: "Your new photo is live on your profile." });
      },
      onError: (error: any) => {
        toast({
          title: "Upload failed",
          description: getUploadErrorMessage(error),
          variant: "destructive",
        });
      },
    },
  });

  const handleSocialChange = (platform: string, value: string) => {
    setSocialLinks((prev) => ({ ...prev, [platform]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDisplayName = displayName.trim();

    if (!trimmedDisplayName) {
      toast({
        title: "Display name required",
        description: "Every account must keep a public display name.",
        variant: "destructive",
      });
      return;
    }

    const filteredSocialLinks = Object.fromEntries(
      Object.entries(socialLinks).filter(([, value]) => value && value.trim() !== ""),
    );

    updateMe.mutate({
      data: {
        name: trimmedDisplayName,
        username: username || undefined,
        bio: bio || undefined,
        website: website || undefined,
        socialLinks: Object.keys(filteredSocialLinks).length > 0 ? filteredSocialLinks : undefined,
      },
    });
  };

  const handleProfilePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    uploadProfilePhoto.mutate({ data: { file } });
  };

  const handleSelectLibraryProfilePhoto = (url: string) => {
    updateMe.mutate({ data: { imageUrl: url } });
  };

  if (isUserLoading) {
    return <div className="container mx-auto max-w-2xl px-4 py-16 text-center">Loading settings...</div>;
  }

  if (!currentUser) {
    setLocation("/sign-in");
    return null;
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>

      {currentUser && siteSettings ? (
        <div className="mb-6">
          <UserPageCustomizationCard user={currentUser} siteSettings={siteSettings} />
        </div>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Profile Photo</CardTitle>
          <CardDescription>Update the image shown on your public profile and comments.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20 border border-border">
                <AvatarImage src={currentUser.imageUrl || undefined} alt={currentUser.name || "User"} />
                <AvatarFallback className="text-2xl font-bold">
                  {(currentUser.name || currentUser.email || "U").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{currentUser.name}</p>
                <p className="text-xs text-muted-foreground">
                  PNG, JPEG, WebP, GIF, AVIF · max 8 MB
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadProfilePhoto.isPending}
              >
                <Camera className="h-4 w-4" />
                {uploadProfilePhoto.isPending ? "Uploading..." : "Upload photo"}
              </Button>
              {currentUser.role === "owner" && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setIsImageLibraryOpen(true)}
                  disabled={updateMe.isPending}
                >
                  <ImageIcon className="h-4 w-4" />
                  Choose from library
                </Button>
              )}
            </div>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            aria-label="Choose profile photo"
            className="hidden"
            onChange={handleProfilePhotoChange}
            disabled={uploadProfilePhoto.isPending}
          />
        </CardContent>
      </Card>

      {currentUser.role === "owner" && (
        <FeaturedImagePicker
          open={isImageLibraryOpen}
          onOpenChange={setIsImageLibraryOpen}
          currentUrl={currentUser.imageUrl || undefined}
          dialogTitle="Choose Profile Photo"
          finalActionLabel="Use as profile photo"
          closeWarningDescription="You have selected a profile photo but have not saved it yet."
          onSelect={handleSelectLibraryProfilePhoto}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Update your public profile details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                placeholder="How your name appears publicly"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={255}
              />
              <p className="text-xs text-muted-foreground">
                Required. This is the public name shown on your profile, posts, and comments.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-muted-foreground">@</span>
                <Input
                  id="username"
                  className="pl-7"
                  placeholder="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                />
              </div>
              <p className="text-xs text-muted-foreground">Alphanumeric and underscores only (3-30 characters).</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                placeholder="Tell the world about yourself..."
                className="resize-none h-24"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={500}
              />
              <div className="text-right text-xs text-muted-foreground">
                {bio.length}/500
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="website"
                  className="pl-9"
                  placeholder="https://yourwebsite.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Social Links</CardTitle>
            <CardDescription>Add links to your other platforms.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="instagram">Instagram</Label>
                <div className="relative">
                  <Instagram className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="instagram"
                    className="pl-9"
                    placeholder="https://instagram.com/yourhandle"
                    value={socialLinks.instagram || ""}
                    onChange={(e) => handleSocialChange("instagram", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="twitter">X (formerly Twitter)</Label>
                <div className="relative">
                  <Twitter className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="twitter"
                    className="pl-9"
                    placeholder="https://x.com/yourhandle"
                    value={socialLinks.twitter || ""}
                    onChange={(e) => handleSocialChange("twitter", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="youtube">YouTube</Label>
                <div className="relative">
                  <Youtube className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="youtube"
                    className="pl-9"
                    placeholder="https://youtube.com/@yourchannel"
                    value={socialLinks.youtube || ""}
                    onChange={(e) => handleSocialChange("youtube", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tiktok">TikTok</Label>
                <div className="relative">
                  <Music2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="tiktok"
                    className="pl-9"
                    placeholder="https://tiktok.com/@yourhandle"
                    value={socialLinks.tiktok || ""}
                    onChange={(e) => handleSocialChange("tiktok", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="twitch">Twitch</Label>
                <div className="relative">
                  <Tv className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="twitch"
                    className="pl-9"
                    placeholder="https://twitch.tv/yourchannel"
                    value={socialLinks.twitch || ""}
                    onChange={(e) => handleSocialChange("twitch", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="github">GitHub</Label>
                <div className="relative">
                  <Github className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="github"
                    className="pl-9"
                    placeholder="https://github.com/yourhandle"
                    value={socialLinks.github || ""}
                    onChange={(e) => handleSocialChange("github", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="linkedin">LinkedIn</Label>
                <div className="relative">
                  <Linkedin className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="linkedin"
                    className="pl-9"
                    placeholder="https://linkedin.com/in/yourhandle"
                    value={socialLinks.linkedin || ""}
                    onChange={(e) => handleSocialChange("linkedin", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end border-t p-6">
            <Button type="submit" disabled={updateMe.isPending}>
              {updateMe.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
