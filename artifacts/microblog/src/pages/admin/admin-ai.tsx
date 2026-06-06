import { useEffect, useState, useCallback } from "react";
import {
  getGetMyAiSettingsQueryKey,
  useGetMyAiSettings,
  useUpdateMyAiSettings,
  type UpdateMyAiSettingsBody,
  type UpdateMyAiVendorKeyBody,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useToast } from "@/hooks/use-toast";

const TASK_PREF_NONE = "__none__";

const TEXT_GENERATION_VENDORS = ["openrouter", "opencode-zen", "opencode-go", "google", "mistral", "mistral-vibe", "deepseek"] as const;
const IMAGE_DESCRIPTION_VENDORS = ["openrouter", "opencode-zen", "opencode-go", "google", "mistral", "mistral-vibe"] as const;
const PIECE_GENERATION_VENDORS = ["opencode-zen", "opencode-go", "google", "mistral", "mistral-vibe", "deepseek"] as const;

const OPENCODE_GO_ENDPOINT_KINDS = [
  { value: "", label: "Auto-detect from model name" },
  { value: "chat-completions", label: "OpenAI Chat Completions" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
] as const;

const OPENCODE_ZEN_ENDPOINT_KINDS = [
  { value: "", label: "Auto-detect from model name" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "chat-completions", label: "OpenAI Chat Completions" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generate", label: "Google Generate Content" },
] as const;

type ProfileDraftKey = number | `new-${string}`;

type ProfileDraft = {
  vendor: string;
  vendorLabel: string;
  profileName: string;
  autoName: boolean;
  enabled: boolean;
  model: string;
  endpointKind: string;
  isNew: boolean;
  toDelete: boolean;
};

type DraftState = Record<ProfileDraftKey, ProfileDraft>;
type KeyDraftState = Record<string, string>; // vendor → plaintext key (empty = unchanged)

const AI_VENDOR_OPTIONS = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "opencode-zen", label: "Opencode Zen" },
  { id: "opencode-go", label: "Opencode Go" },
  { id: "google", label: "Google" },
  { id: "mistral", label: "Mistral AI" },
  { id: "mistral-vibe", label: "Mistral Vibe" },
  { id: "deepseek", label: "DeepSeek" },
] as const;

function getVendorLabel(vendor: string): string {
  return AI_VENDOR_OPTIONS.find((v) => v.id === vendor)?.label ?? vendor;
}

function autoProfileName(vendorLabel: string, model: string): string {
  const m = model.trim();
  return m ? `${vendorLabel} - ${m}` : vendorLabel;
}

let newProfileCounter = 0;
function newProfileKey(): `new-${string}` {
  return `new-${++newProfileCounter}`;
}

function buildDraftFromProfile(
  profile: { id: number; vendor: string; vendorLabel: string; profileName: string; enabled: boolean; configured: boolean; model?: string | null; endpointKind?: string | null },
): [number, ProfileDraft] {
  const model = profile.model ?? "";
  const expectedAutoName = autoProfileName(profile.vendorLabel, model);
  return [
    profile.id,
    {
      vendor: profile.vendor,
      vendorLabel: profile.vendorLabel,
      profileName: profile.profileName,
      autoName: profile.profileName === expectedAutoName,
      enabled: profile.enabled,
      model,
      endpointKind: profile.endpointKind ?? "",
      isNew: false,
      toDelete: false,
    },
  ];
}

export default function AdminAiPage() {
  const { isOwner } = useCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [profileDrafts, setProfileDrafts] = useState<DraftState>({});
  const [keyDrafts, setKeyDrafts] = useState<KeyDraftState>({});
  const [prefTextImprove, setPrefTextImprove] = useState<string>(TASK_PREF_NONE);
  const [prefAltText, setPrefAltText] = useState<string>(TASK_PREF_NONE);
  const [prefArtPiece, setPrefArtPiece] = useState<string>(TASK_PREF_NONE);
  const [error, setError] = useState<string | null>(null);

  const aiSettings = useGetMyAiSettings({
    query: {
      queryKey: getGetMyAiSettingsQueryKey(),
      enabled: isOwner,
    },
  });

  useEffect(() => {
    if (aiSettings.data) {
      const newDrafts: DraftState = {};
      for (const profile of aiSettings.data.profiles) {
        const [key, draft] = buildDraftFromProfile(profile);
        newDrafts[key] = draft;
      }
      setProfileDrafts(newDrafts);
      setKeyDrafts({}); // clear key drafts on reload (keys are not shown in plaintext)
      setPrefTextImprove(String(aiSettings.data.preferredTextImproveProfileId ?? TASK_PREF_NONE));
      setPrefAltText(String(aiSettings.data.preferredAltTextProfileId ?? TASK_PREF_NONE));
      setPrefArtPiece(String(aiSettings.data.preferredArtPieceProfileId ?? TASK_PREF_NONE));
      setError(null);
    }
  }, [aiSettings.data]);

  const updateDraft = useCallback((key: ProfileDraftKey, patch: Partial<ProfileDraft>) => {
    setProfileDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return { ...prev, [key]: { ...current, ...patch } };
    });
  }, []);

  const handleModelChange = useCallback((key: ProfileDraftKey, model: string) => {
    setProfileDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const nextName = current.autoName ? autoProfileName(current.vendorLabel, model) : current.profileName;
      return { ...prev, [key]: { ...current, model, profileName: nextName } };
    });
  }, []);

  const handleNameChange = useCallback((key: ProfileDraftKey, name: string) => {
    setProfileDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const expectedAuto = autoProfileName(current.vendorLabel, current.model);
      return { ...prev, [key]: { ...current, profileName: name, autoName: name === expectedAuto } };
    });
  }, []);

  const addProfile = useCallback((vendor: string) => {
    const vendorLabel = getVendorLabel(vendor);
    const key = newProfileKey();
    setProfileDrafts((prev) => ({
      ...prev,
      [key]: {
        vendor,
        vendorLabel,
        profileName: "",
        autoName: true,
        enabled: false,
        model: "",
        endpointKind: "",
        isNew: true,
        toDelete: false,
      },
    }));
  }, []);

  const markDelete = useCallback((key: ProfileDraftKey) => {
    setProfileDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      if (current.isNew) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...current, toDelete: true } };
    });
  }, []);

  const updateAiSettings = useUpdateMyAiSettings({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyAiSettingsQueryKey(), data);
        queryClient.invalidateQueries({ queryKey: getGetMyAiSettingsQueryKey() });
        const newDrafts: DraftState = {};
        for (const profile of data.profiles) {
          const [key, draft] = buildDraftFromProfile(profile);
          newDrafts[key] = draft;
        }
        setProfileDrafts(newDrafts);
        setKeyDrafts({});
        setPrefTextImprove(String(data.preferredTextImproveProfileId ?? TASK_PREF_NONE));
        setPrefAltText(String(data.preferredAltTextProfileId ?? TASK_PREF_NONE));
        setPrefArtPiece(String(data.preferredArtPieceProfileId ?? TASK_PREF_NONE));
        setError(null);
        toast({
          title: "AI settings saved",
          description: "Your AI vendor keys and profiles have been updated.",
        });
      },
      onError: (mutationError: unknown) => {
        const message =
          (mutationError as { data?: { error?: string }; response?: { data?: { error?: string } } })?.data?.error ||
          (mutationError as { data?: { error?: string }; response?: { data?: { error?: string } } })?.response?.data?.error ||
          "Failed to save AI settings";
        setError(message);
        toast({ title: "Error", description: message, variant: "destructive" });
      },
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Build vendor keys payload (only include vendors where a new key was typed)
    const vendorKeysPayload: UpdateMyAiSettingsBody["vendorKeys"] = [];
    for (const [vendor, apiKey] of Object.entries(keyDrafts)) {
      if (apiKey.trim()) {
        vendorKeysPayload.push({
          vendor: vendor as UpdateMyAiVendorKeyBody["vendor"],
          apiKey: apiKey.trim(),
        });
      }
    }

    // Build profiles payload
    const profilesPayload: NonNullable<UpdateMyAiSettingsBody["profiles"]> = [];
    const deletedProfileIds: number[] = [];

    const vendorHasKey = new Set([
      ...Object.entries(keyDrafts).filter(([, k]) => k.trim()).map(([v]) => v),
      ...(aiSettings.data?.vendorKeys.filter((vk) => vk.hasKey).map((vk) => vk.vendor) ?? []),
    ]);

    for (const [rawKey, draft] of Object.entries(profileDrafts) as [string, ProfileDraft][]) {
      if (draft.toDelete) {
        deletedProfileIds.push(Number(rawKey));
        continue;
      }

      const profileName = draft.profileName.trim() || autoProfileName(draft.vendorLabel, draft.model);

      if (draft.enabled && !draft.model.trim()) {
        setError(`Profile "${profileName}" requires a model before it can be enabled.`);
        return;
      }
      if (draft.enabled && !vendorHasKey.has(draft.vendor)) {
        setError(`Profile "${profileName}" requires an API key for ${draft.vendorLabel}. Add one in the "AI API Keys" section above.`);
        return;
      }

      const entry: NonNullable<UpdateMyAiSettingsBody["profiles"]>[number] = {
        vendor: draft.vendor as NonNullable<UpdateMyAiSettingsBody["profiles"]>[number]["vendor"],
        profileName,
        enabled: draft.enabled,
        model: draft.model.trim() || undefined,
        endpointKind: (draft.endpointKind || null) as NonNullable<UpdateMyAiSettingsBody["profiles"]>[number]["endpointKind"],
      };

      if (!draft.isNew) {
        entry.id = Number(rawKey);
      }

      profilesPayload.push(entry);
    }

    const toId = (val: string): number | null => {
      if (val === TASK_PREF_NONE || !val) return null;
      const n = Number(val);
      return isNaN(n) ? null : n;
    };

    const safePref = (val: string, allowedVendors: readonly string[]): number | null => {
      const id = toId(val);
      if (id === null) return null;
      const draft = Object.entries(profileDrafts).find(([k]) => Number(k) === id)?.[1];
      if (!draft || !allowedVendors.includes(draft.vendor)) return null;
      return id;
    };

    const payload: UpdateMyAiSettingsBody = {
      vendorKeys: vendorKeysPayload.length > 0 ? vendorKeysPayload : undefined,
      profiles: profilesPayload,
      deletedProfileIds: deletedProfileIds.length > 0 ? deletedProfileIds : undefined,
      preferredArtPieceProfileId: safePref(prefArtPiece, PIECE_GENERATION_VENDORS),
      preferredTextImproveProfileId: safePref(prefTextImprove, TEXT_GENERATION_VENDORS),
      preferredAltTextProfileId: safePref(prefAltText, IMAGE_DESCRIPTION_VENDORS),
    };

    updateAiSettings.mutate({ data: payload });
  };

  const yellowInputClass =
    "rounded-none border-2 border-yellow-400 bg-zinc-100 text-zinc-950 shadow-[3px_3px_0_0_rgba(0,0,0,0.95)] focus-visible:ring-0 focus-visible:border-yellow-500 dark:bg-zinc-950 dark:text-zinc-50";

  const yellowSelectClass =
    "h-9 w-full rounded-none border-2 border-yellow-400 bg-zinc-100 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(0,0,0,0.95)] focus:outline-none dark:bg-zinc-950 dark:text-zinc-50";

  const vendorKeys = aiSettings.data?.vendorKeys ?? [];
  const draftEntries = Object.entries(profileDrafts) as [string, ProfileDraft][];
  const vendorGroups = AI_VENDOR_OPTIONS.map((vendor) => ({
    vendor: vendor.id,
    vendorLabel: vendor.label,
    profiles: draftEntries.filter(([, d]) => d.vendor === vendor.id && !d.toDelete),
  }));

  const enabledProfiles = draftEntries
    .filter(([, d]) => !d.isNew && d.enabled && !d.toDelete)
    .map(([k, d]) => ({ id: Number(k), vendor: d.vendor, profileName: d.profileName.trim() || autoProfileName(d.vendorLabel, d.model) }));

  const enabledTextProfiles = enabledProfiles.filter((p) => TEXT_GENERATION_VENDORS.includes(p.vendor as (typeof TEXT_GENERATION_VENDORS)[number]));
  const enabledImageDescProfiles = enabledProfiles.filter((p) => IMAGE_DESCRIPTION_VENDORS.includes(p.vendor as (typeof IMAGE_DESCRIPTION_VENDORS)[number]));
  const enabledPieceProfiles = enabledProfiles.filter((p) => PIECE_GENERATION_VENDORS.includes(p.vendor as (typeof PIECE_GENERATION_VENDORS)[number]));

  return (
    <AdminLayout
      title="AI"
      description="Owner-only AI vendor configuration for post drafting and editing."
    >
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Section 1: API Keys (one per vendor) ── */}
        <Card className="border-2 border-yellow-400 bg-zinc-50 text-zinc-950 shadow-[6px_6px_0_0_rgba(0,0,0,0.95)] dark:bg-zinc-950 dark:text-zinc-50">
          <CardHeader>
            <CardTitle>AI API Keys</CardTitle>
            <CardDescription className="text-zinc-700 dark:text-zinc-300">
              One API key per vendor. Keys are shared across all profiles for the same vendor — enter a key once and all your profiles for that vendor use it automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {vendorKeys.length === 0 && aiSettings.isLoading ? (
              <p className="text-sm text-zinc-500">Loading…</p>
            ) : (
              AI_VENDOR_OPTIONS.map((vendor) => {
                const keyInfo = vendorKeys.find((vk) => vk.vendor === vendor.id);
                const hasKey = keyInfo?.hasKey ?? false;
                const draftKey = keyDrafts[vendor.id] ?? "";
                return (
                  <div key={vendor.id} className="grid gap-3 sm:grid-cols-[160px_1fr] items-center">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{vendor.label}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {hasKey ? "Key saved on file." : "No key configured."}
                      </p>
                    </div>
                    <Input
                      type="password"
                      value={draftKey}
                      onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [vendor.id]: e.target.value }))}
                      placeholder={hasKey ? "Saved key on file. Enter a new one to replace." : "Paste your API key"}
                      className={yellowInputClass}
                    />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ── Section 2: Profiles (many per vendor, no API key field) ── */}
        <Card className="border-2 border-yellow-400 bg-zinc-50 text-zinc-950 shadow-[6px_6px_0_0_rgba(0,0,0,0.95)] dark:bg-zinc-950 dark:text-zinc-50">
          <CardHeader>
            <CardTitle>AI Profiles</CardTitle>
            <CardDescription className="text-zinc-700 dark:text-zinc-300">
              Each profile pairs a vendor with a specific model. Multiple profiles per vendor let you use different models for different tasks — all sharing the same API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {vendorGroups.map(({ vendor, vendorLabel, profiles }) => {
              const vendorKeyInfo = vendorKeys.find((vk) => vk.vendor === vendor);
              const hasKey = vendorKeyInfo?.hasKey || Boolean(keyDrafts[vendor]?.trim());
              return (
                <section key={vendor} className="space-y-3">
                  <div className="flex items-center justify-between border-b-2 border-yellow-400 pb-1">
                    <h3 className="text-sm font-semibold uppercase tracking-wide">{vendorLabel}</h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addProfile(vendor)}
                      className="h-7 rounded-none border border-yellow-400 px-2 text-xs hover:bg-yellow-50 dark:hover:bg-zinc-900"
                    >
                      + Add profile
                    </Button>
                  </div>

                  {!hasKey && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Add an API key for {vendorLabel} above to enable profiles for this vendor.
                    </p>
                  )}

                  {profiles.length === 0 && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">No profiles yet. Click "Add profile" to create one.</p>
                  )}

                  {profiles.map(([rawKey, draft]) => {
                    const key = rawKey.startsWith("new-") ? (rawKey as `new-${string}`) : Number(rawKey);
                    const canDelete = profiles.length > 1 || draft.isNew;
                    const endpointOptions =
                      vendor === "opencode-go"
                        ? OPENCODE_GO_ENDPOINT_KINDS
                        : vendor === "opencode-zen"
                        ? OPENCODE_ZEN_ENDPOINT_KINDS
                        : null;
                    const displayName = draft.profileName.trim() || autoProfileName(draft.vendorLabel, draft.model);
                    const fullyReady = !draft.isNew && aiSettings.data?.profiles.some((p) => p.id === Number(rawKey) && p.configured);

                    return (
                      <div
                        key={rawKey}
                        className="space-y-3 rounded-none border-2 border-yellow-400 bg-zinc-100 p-4 dark:bg-zinc-900"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">
                            {fullyReady
                              ? "Configured. Ready to use."
                              : !hasKey
                              ? "Add an API key for this vendor above."
                              : "Add a model slug to enable."}
                          </p>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-sm font-medium">
                              <Checkbox
                                checked={draft.enabled}
                                onCheckedChange={(checked) => updateDraft(key, { enabled: checked === true })}
                                className="h-5 w-5 rounded-none border-2 border-yellow-400 data-[state=checked]:bg-yellow-400 data-[state=checked]:text-black"
                              />
                              Enabled
                            </label>
                            {canDelete && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => markDelete(key)}
                                className="h-7 rounded-none border border-red-400 px-2 text-xs text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-zinc-900"
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`profile-name-${rawKey}`} className="text-xs">Profile Name</Label>
                            <Input
                              id={`profile-name-${rawKey}`}
                              value={draft.profileName}
                              onChange={(e) => handleNameChange(key, e.target.value)}
                              placeholder={displayName}
                              className={yellowInputClass}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`model-${rawKey}`} className="text-xs">Model Slug</Label>
                            <Input
                              id={`model-${rawKey}`}
                              value={draft.model}
                              onChange={(e) => handleModelChange(key, e.target.value)}
                              placeholder={
                                vendor === "opencode-zen" ? "big-pickle"
                                : vendor === "opencode-go" ? "minimax-m3"
                                : vendor === "mistral" ? "mistral-small-latest"
                                : vendor === "mistral-vibe" ? "mistral-vibe-cli-latest"
                                : vendor === "deepseek" ? "deepseek-v4-flash"
                                : "Enter the provider model slug"
                              }
                              className={yellowInputClass}
                            />
                          </div>
                          {endpointOptions && (
                            <div className="space-y-1">
                              <Label htmlFor={`endpoint-kind-${rawKey}`} className="text-xs">Endpoint Kind</Label>
                              <select
                                id={`endpoint-kind-${rawKey}`}
                                value={draft.endpointKind}
                                onChange={(e) => updateDraft(key, { endpointKind: e.target.value })}
                                className={yellowSelectClass}
                              >
                                {endpointOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        {(vendor === "opencode-go" || vendor === "opencode-zen") && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Set Endpoint Kind to bypass model-name detection for any model.{" "}
                            <a
                              href="https://opencode.ai"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:text-yellow-600"
                            >
                              Opencode model docs ↗
                            </a>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}

            {error ? (
              <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
            ) : null}
          </CardContent>
        </Card>

        {/* ── Section 3: Task Preferences ── */}
        {enabledProfiles.length > 0 && (() => {
          const taskPrefSelectClass =
            "h-9 w-full rounded-none border-2 border-yellow-400 bg-zinc-100 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(234,179,8,1)] focus:outline-none dark:bg-zinc-950 dark:text-zinc-50";

          const taskPrefs = [
            { id: "textImprove", label: "Text improvement", value: prefTextImprove, onChange: setPrefTextImprove, profiles: enabledTextProfiles },
            { id: "altText", label: "Visual descriptions", value: prefAltText, onChange: setPrefAltText, profiles: enabledImageDescProfiles },
            { id: "artPiece", label: "Art pieces", value: prefArtPiece, onChange: setPrefArtPiece, profiles: enabledPieceProfiles },
          ];

          return (
            <Card className="border-2 border-yellow-400 bg-zinc-50 text-zinc-950 shadow-[6px_6px_0_0_rgba(0,0,0,0.95)] dark:bg-zinc-950 dark:text-zinc-50">
              <CardHeader>
                <CardTitle>Task Preferences</CardTitle>
                <CardDescription className="text-zinc-700 dark:text-zinc-300">
                  Set a default AI profile per task so you are not prompted each time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {taskPrefs.map(({ id, label, value, onChange, profiles: taskProfiles }) => {
                  const safeValue =
                    value !== TASK_PREF_NONE && taskProfiles.some((p) => String(p.id) === value)
                      ? value
                      : TASK_PREF_NONE;
                  return (
                    <div key={id} className="grid gap-2 md:grid-cols-[180px_1fr]">
                      <Label htmlFor={`task-pref-${id}`} className="flex items-center text-sm font-medium">{label}</Label>
                      <select
                        id={`task-pref-${id}`}
                        value={safeValue}
                        onChange={(e) => onChange(e.target.value)}
                        className={taskPrefSelectClass}
                      >
                        <option value={TASK_PREF_NONE}>None (ask each time)</option>
                        {taskProfiles.map((p) => (
                          <option key={p.id} value={String(p.id)}>{p.profileName}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })()}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={updateAiSettings.isPending || aiSettings.isLoading}
            className="rounded-none border-2 border-yellow-400 bg-zinc-950 text-yellow-300 shadow-[4px_4px_0_0_rgba(234,179,8,1)] hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-950"
          >
            {updateAiSettings.isPending ? "Saving AI Settings..." : "Save AI Settings"}
          </Button>
        </div>
      </form>
    </AdminLayout>
  );
}
