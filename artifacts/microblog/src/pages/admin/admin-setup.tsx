import { useEffect, useState } from "react";
import { Redirect, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBootstrapStatus,
  useUpdateMe,
  useUpdateSiteSettings,
  useCompleteBootstrapSetup,
  getGetBootstrapStatusQueryKey,
  getGetMeQueryKey,
  getGetSiteSettingsQueryKey,
} from "@workspace/api-client-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function AdminSetupPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { currentUser, isLoading: isUserLoading } = useCurrentUser();
  const bootstrapQuery = useGetBootstrapStatus({
    query: {
      queryKey: getGetBootstrapStatusQueryKey(),
      staleTime: 10_000,
    },
  });
  const { data: siteSettings } = useSiteSettings();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [siteTitle, setSiteTitle] = useState("");
  const [heroHeading, setHeroHeading] = useState("");
  const [heroSubheading, setHeroSubheading] = useState("");
  const [aboutBody, setAboutBody] = useState("");

  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.name ?? "");
      setUsername(currentUser.username ?? "");
    }
  }, [currentUser]);

  useEffect(() => {
    if (siteSettings) {
      setSiteTitle(siteSettings.siteTitle ?? "");
      setHeroHeading(siteSettings.heroHeading ?? "");
      setHeroSubheading(siteSettings.heroSubheading ?? "");
      setAboutBody(siteSettings.aboutBody ?? "");
    }
  }, [siteSettings]);

  const invalidateBootstrapQueries = () => {
    queryClient.invalidateQueries({ queryKey: getGetBootstrapStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() });
  };

  const updateMe = useUpdateMe({
    mutation: {
      onSuccess: () => {
        invalidateBootstrapQueries();
        toast({ title: "Profile saved", description: "Owner identity updated." });
      },
      onError: (error: unknown) => {
        const message =
          typeof error === "object" && error && "response" in error
            ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
            : "Failed to save owner profile.";
        toast({ title: "Error", description: message || "Failed to save owner profile.", variant: "destructive" });
      },
    },
  });

  const updateSite = useUpdateSiteSettings({
    mutation: {
      onSuccess: () => {
        invalidateBootstrapQueries();
        toast({ title: "Site identity saved", description: "Core CMS shell copy updated." });
      },
      onError: (error: unknown) => {
        const message =
          typeof error === "object" && error && "response" in error
            ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
            : "Failed to save site identity.";
        toast({ title: "Error", description: message || "Failed to save site identity.", variant: "destructive" });
      },
    },
  });

  const completeSetup = useCompleteBootstrapSetup({
    mutation: {
      onSuccess: () => {
        invalidateBootstrapQueries();
        toast({ title: "Setup complete", description: "Your CMS shell is now live." });
      },
      onError: (error: unknown) => {
        const message =
          typeof error === "object" && error && "response" in error
            ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
            : "Finish the required fields before going live.";
        toast({ title: "Setup incomplete", description: message || "Finish the required fields before going live.", variant: "destructive" });
      },
    },
  });

  if (isUserLoading || bootstrapQuery.isLoading) {
    return <div className="container mx-auto max-w-4xl px-4 py-16 text-center text-sm text-muted-foreground">Loading setup…</div>;
  }

  if (!currentUser) {
    return <Redirect to="/sign-in?next=/admin/setup" />;
  }

  if (currentUser.role !== "owner") {
    return <Redirect to="/" />;
  }

  if (bootstrapQuery.data?.isSetupComplete) {
    return <Redirect to="/admin/site" />;
  }

  const checklist = bootstrapQuery.data?.checklist;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8 space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">CMS shell setup</p>
        <h1 className="text-3xl font-bold tracking-tight">Claim this site and finish first-run setup</h1>
        <p className="max-w-3xl text-muted-foreground">
          This database is live, but the public shell stays gated until the owner profile and core site identity are configured.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Owner identity</CardTitle>
              <CardDescription>These values establish the canonical author for this CMS shell.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  maxLength={30}
                />
              </div>
              <Button
                type="button"
                onClick={() =>
                  updateMe.mutate({
                    data: {
                      name: displayName.trim(),
                      username: username.trim() || undefined,
                    },
                  })
                }
                disabled={updateMe.isPending}
              >
                {updateMe.isPending ? "Saving…" : "Save owner identity"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Public site identity</CardTitle>
              <CardDescription>These fields define the initial public face of the copied shell.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="siteTitle">Site title</Label>
                <Input
                  id="siteTitle"
                  value={siteTitle}
                  onChange={(event) => setSiteTitle(event.target.value)}
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="heroHeading">Hero heading</Label>
                <Input
                  id="heroHeading"
                  value={heroHeading}
                  onChange={(event) => setHeroHeading(event.target.value)}
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="heroSubheading">Hero subheading</Label>
                <Textarea
                  id="heroSubheading"
                  value={heroSubheading}
                  onChange={(event) => setHeroSubheading(event.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aboutBody">About body</Label>
                <Textarea
                  id="aboutBody"
                  value={aboutBody}
                  onChange={(event) => setAboutBody(event.target.value)}
                  rows={5}
                />
              </div>
              <Button
                type="button"
                onClick={() =>
                  updateSite.mutate({
                    data: {
                      siteTitle: siteTitle.trim(),
                      heroHeading: heroHeading.trim(),
                      heroSubheading: heroSubheading.trim(),
                      aboutBody: aboutBody.trim(),
                    },
                  })
                }
                disabled={updateSite.isPending}
              >
                {updateSite.isPending ? "Saving…" : "Save site identity"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Launch checklist</CardTitle>
              <CardDescription>The public setup gate lifts when every required item is ready.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ChecklistItem label="Owner display name" ready={Boolean(checklist?.ownerDisplayNameReady)} />
              <ChecklistItem label="Owner username" ready={Boolean(checklist?.ownerUsernameReady)} />
              <ChecklistItem label="Site title" ready={Boolean(checklist?.siteTitleReady)} />
              <ChecklistItem label="Hero heading" ready={Boolean(checklist?.heroHeadingReady)} />
              <ChecklistItem label="Hero subheading" ready={Boolean(checklist?.heroSubheadingReady)} />
              <ChecklistItem label="About body" ready={Boolean(checklist?.aboutBodyReady)} />
              <Button
                className="mt-3 w-full"
                type="button"
                onClick={() => completeSetup.mutate()}
                disabled={completeSetup.isPending}
              >
                {completeSetup.isPending ? "Going live…" : "Complete setup and go live"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Next after launch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>You can keep refining the shell after launch from the normal admin surfaces.</p>
              <div className="flex flex-col gap-2">
                <Link href="/settings" className="font-medium text-primary hover:underline">
                  Continue in Settings
                </Link>
                <Link href="/admin/site" className="font-medium text-primary hover:underline">
                  Open site customization
                </Link>
                <Link href="/admin/platforms" className="font-medium text-primary hover:underline">
                  Configure syndication platforms
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
      <span>{label}</span>
      <span className={ready ? "font-medium text-primary" : "text-muted-foreground"}>
        {ready ? "Ready" : "Missing"}
      </span>
    </div>
  );
}
