import { useEffect, useState } from "react";
import {
  getGetMyAiSettingsQueryKey,
  useGetMyAiSettings,
  useUpdateMyAiSettings,
  type UpdateMyAiSettingsBody,
  type UpdateMyAiSettingsBodyPreferredArtPieceVendor,
  type UpdateMyAiSettingsBodyPreferredVendorTextImprove,
  type UpdateMyAiSettingsBodyPreferredVendorAltText,
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
const PIECE_GENERATION_VENDORS = ["google", "mistral", "mistral-vibe", "deepseek"] as const;

const DEFAULT_MODEL_BY_VENDOR: Record<string, string> = {
  deepseek: "deepseek-v4-flash",
};

type VendorDraftState = Record<string, { enabled: boolean; model: string; apiKey: string }>;

function createDraftState(
  settings: Array<{ vendor: string; enabled: boolean; model?: string | null }>,
): VendorDraftState {
  return Object.fromEntries(
    settings.map((setting) => [
      setting.vendor,
      {
        enabled: setting.enabled,
        model: setting.model ?? DEFAULT_MODEL_BY_VENDOR[setting.vendor] ?? "",
        apiKey: "",
      },
    ]),
  );
}

function isAllowedVendor(vendor: string, allowlist: readonly string[]) {
  return allowlist.includes(vendor);
}

export default function AdminAiPage() {
  const { isOwner } = useCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<VendorDraftState>({});
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
      setDrafts(createDraftState(aiSettings.data.settings));
      setPrefTextImprove(aiSettings.data.preferredVendorTextImprove ?? TASK_PREF_NONE);
      setPrefAltText(aiSettings.data.preferredVendorAltText ?? TASK_PREF_NONE);
      setPrefArtPiece(aiSettings.data.preferredArtPieceVendor ?? TASK_PREF_NONE);
      setError(null);
    }
  }, [aiSettings.data]);

  const updateAiSettings = useUpdateMyAiSettings({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetMyAiSettingsQueryKey(), data);
        setDrafts(createDraftState(data.settings));
        setPrefTextImprove(data.preferredVendorTextImprove ?? TASK_PREF_NONE);
        setPrefAltText(data.preferredVendorAltText ?? TASK_PREF_NONE);
        setPrefArtPiece(data.preferredArtPieceVendor ?? TASK_PREF_NONE);
        setError(null);
        toast({
          title: "AI settings saved",
          description: "Your owner-only AI vendor settings have been updated.",
        });
      },
      onError: (mutationError: any) => {
        const message = mutationError?.data?.error || mutationError?.response?.data?.error || "Failed to save AI settings";
        setError(message);
        toast({ title: "Error", description: message, variant: "destructive" });
      },
    },
  });

  const yellowInputClass =
    "rounded-none border-2 border-yellow-400 bg-zinc-100 text-zinc-950 shadow-[3px_3px_0_0_rgba(0,0,0,0.95)] focus-visible:ring-0 focus-visible:border-yellow-500 dark:bg-zinc-950 dark:text-zinc-50";

  const settings = aiSettings.data?.settings ?? [];

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    for (const setting of settings) {
      const draft = drafts[setting.vendor] ?? { enabled: false, model: "", apiKey: "" };
      if (draft.enabled && draft.model.trim() === "") {
        setError(`${setting.vendorLabel} requires a model before it can be enabled.`);
        return;
      }
      if (draft.enabled && draft.apiKey.trim() === "" && !setting.configured) {
        setError(`${setting.vendorLabel} requires an API key before it can be enabled.`);
        return;
      }
    }

    const enabledVendors = settings.filter((s) => {
      const draft = drafts[s.vendor] ?? { enabled: false, model: "", apiKey: "" };
      return draft.enabled && (s.configured || draft.apiKey.trim() !== "");
    });
    const safePrefTextImprove =
      prefTextImprove !== TASK_PREF_NONE && enabledVendors.some((v) => v.vendor === prefTextImprove && isAllowedVendor(v.vendor, TEXT_GENERATION_VENDORS))
        ? prefTextImprove
        : TASK_PREF_NONE;
    const safePrefAltText =
      prefAltText !== TASK_PREF_NONE && enabledVendors.some((v) => v.vendor === prefAltText && isAllowedVendor(v.vendor, IMAGE_DESCRIPTION_VENDORS))
        ? prefAltText
        : TASK_PREF_NONE;
    const safePrefArtPiece =
      prefArtPiece !== TASK_PREF_NONE && enabledVendors.some((v) => v.vendor === prefArtPiece && isAllowedVendor(v.vendor, PIECE_GENERATION_VENDORS))
        ? prefArtPiece
        : TASK_PREF_NONE;

    const payload: UpdateMyAiSettingsBody = {
      settings: settings.map((setting) => {
        const draft = drafts[setting.vendor] ?? { enabled: false, model: "", apiKey: "" };
        return {
          vendor: setting.vendor,
          enabled: draft.enabled,
          model: draft.model.trim() || undefined,
          apiKey: draft.apiKey.trim() || undefined,
        };
      }),
      preferredVendorTextImprove: (safePrefTextImprove === TASK_PREF_NONE ? null : safePrefTextImprove) as UpdateMyAiSettingsBodyPreferredVendorTextImprove,
      preferredVendorAltText: (safePrefAltText === TASK_PREF_NONE ? null : safePrefAltText) as UpdateMyAiSettingsBodyPreferredVendorAltText,
      preferredArtPieceVendor: (safePrefArtPiece === TASK_PREF_NONE ? null : safePrefArtPiece) as UpdateMyAiSettingsBodyPreferredArtPieceVendor,
    };

    updateAiSettings.mutate({ data: payload });
  };

  return (
    <AdminLayout
      title="AI"
      description="Owner-only AI vendor configuration for post drafting and editing."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-2 border-yellow-400 bg-zinc-50 text-zinc-950 shadow-[6px_6px_0_0_rgba(0,0,0,0.95)] dark:bg-zinc-950 dark:text-zinc-50">
          <CardHeader>
            <CardTitle>AI Writing Assistant</CardTitle>
            <CardDescription className="text-zinc-700 dark:text-zinc-300">
              Configure the vendors you want available in the post editor. Each vendor keeps its own
              model slug and encrypted API key so you can switch vendors from the editor dropdown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {settings.map((setting) => {
              const draft = drafts[setting.vendor] ?? { enabled: false, model: "", apiKey: "" };
              return (
                <section
                  key={setting.vendor}
                  className="space-y-4 rounded-none border-2 border-yellow-400 bg-zinc-100 p-4 dark:bg-zinc-900"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold">{setting.vendorLabel}</h3>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {setting.configured
                          ? "Configured. Leave the API key field blank to keep the saved key."
                          : "Not configured yet. Add a model and API key to enable it."}
                      </p>
                      {setting.vendor === "mistral-vibe" && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Uses your Mistral Vibe API key. Confirmed model as of May 2026: <code className="font-mono">mistral-vibe-cli-latest</code>
                        </p>
                      )}
                      {setting.vendor === "deepseek" && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Uses your DeepSeek API key. Default model: <code className="font-mono">deepseek-v4-flash</code>. DeepSeek is not offered for image alt text until API image input is verified.
                        </p>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Checkbox
                        checked={draft.enabled}
                        onCheckedChange={(checked) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [setting.vendor]: {
                              ...(prev[setting.vendor] ?? { enabled: false, model: "", apiKey: "" }),
                              enabled: checked === true,
                            },
                          }))
                        }
                        className="h-5 w-5 rounded-none border-2 border-yellow-400 data-[state=checked]:bg-yellow-400 data-[state=checked]:text-black"
                      />
                      Enabled
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`ai-model-${setting.vendor}`}>Model Slug</Label>
                      <Input
                        id={`ai-model-${setting.vendor}`}
                        value={draft.model}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [setting.vendor]: {
                              ...(prev[setting.vendor] ?? { enabled: false, model: "", apiKey: "" }),
                              model: event.target.value,
                            },
                          }))
                        }
                        placeholder={
                          setting.vendor === "opencode-zen"
                            ? "big-pickle"
                            : setting.vendor === "mistral"
                            ? "mistral-small-latest"
                            : setting.vendor === "mistral-vibe"
                            ? "mistral-vibe-cli-latest"
                            : setting.vendor === "deepseek"
                            ? "deepseek-v4-flash"
                            : "Enter the provider model slug"
                        }
                        className={yellowInputClass}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`ai-key-${setting.vendor}`}>API Key</Label>
                      <Input
                        id={`ai-key-${setting.vendor}`}
                        type="password"
                        value={draft.apiKey}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [setting.vendor]: {
                              ...(prev[setting.vendor] ?? { enabled: false, model: "", apiKey: "" }),
                              apiKey: event.target.value,
                            },
                          }))
                        }
                        placeholder={
                          setting.configured
                            ? "Saved API key on file. Enter a new one only to replace it."
                            : "Paste your API key"
                        }
                        className={yellowInputClass}
                      />
                    </div>
                  </div>
                </section>
              );
            })}

            {error ? (
              <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
            ) : null}
          </CardContent>
        </Card>

        {(() => {
          const enabledVendors = settings.filter((s) => s.enabled && s.configured);
          if (enabledVendors.length === 0) return null;
          const enabledTextVendors = enabledVendors.filter((v) =>
            isAllowedVendor(v.vendor, TEXT_GENERATION_VENDORS),
          );
          const enabledImageDescriptionVendors = enabledVendors.filter((v) =>
            isAllowedVendor(v.vendor, IMAGE_DESCRIPTION_VENDORS),
          );
          const enabledPieceVendors = enabledVendors.filter((v) =>
            isAllowedVendor(v.vendor, PIECE_GENERATION_VENDORS),
          );
          const taskPrefSelectClass =
            "h-9 w-full rounded-none border-2 border-yellow-400 bg-zinc-100 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(234,179,8,1)] focus:outline-none dark:bg-zinc-950 dark:text-zinc-50";
          const taskPrefs = [
            { id: "textImprove", label: "Text improvement", value: prefTextImprove, onChange: setPrefTextImprove, vendors: enabledTextVendors },
            { id: "altText", label: "Visual descriptions", value: prefAltText, onChange: setPrefAltText, vendors: enabledImageDescriptionVendors },
            { id: "artPiece", label: "Art pieces", value: prefArtPiece, onChange: setPrefArtPiece, vendors: enabledPieceVendors },
          ];
          return (
            <Card className="border-2 border-yellow-400 bg-zinc-50 text-zinc-950 shadow-[6px_6px_0_0_rgba(0,0,0,0.95)] dark:bg-zinc-950 dark:text-zinc-50">
              <CardHeader>
                <CardTitle>Task Preferences</CardTitle>
                <CardDescription className="text-zinc-700 dark:text-zinc-300">
                  Set a default vendor per task so you are not prompted each time. Only enabled vendors appear here. Art pieces and visual descriptions use separate capability lists. Do a hard refresh (Ctrl+Shift+R, Cmd+Shift+R or F5) to confirm changes are saved.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {taskPrefs.map(({ id, label, value, onChange, vendors }) => {
                  const safeValue = value === TASK_PREF_NONE || vendors.some((v) => v.vendor === value)
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
                        {vendors.map((v) => (
                          <option key={v.vendor} value={v.vendor}>{v.vendorLabel}</option>
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
