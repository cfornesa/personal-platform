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

type VendorDraftState = Record<string, { enabled: boolean; model: string; apiKey: string }>;

function createDraftState(
  settings: Array<{ vendor: string; enabled: boolean; model?: string | null }>,
): VendorDraftState {
  return Object.fromEntries(
    settings.map((setting) => [
      setting.vendor,
      {
        enabled: setting.enabled,
        model: setting.model ?? "",
        apiKey: "",
      },
    ]),
  );
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
        queryClient.invalidateQueries({ queryKey: getGetMyAiSettingsQueryKey() });
        setDrafts(createDraftState(data.settings));
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
      preferredVendorTextImprove: (prefTextImprove === TASK_PREF_NONE ? null : prefTextImprove) as UpdateMyAiSettingsBodyPreferredVendorTextImprove,
      preferredVendorAltText: (prefAltText === TASK_PREF_NONE ? null : prefAltText) as UpdateMyAiSettingsBodyPreferredVendorAltText,
      preferredArtPieceVendor: (prefArtPiece === TASK_PREF_NONE ? null : prefArtPiece) as UpdateMyAiSettingsBodyPreferredArtPieceVendor,
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
                        placeholder={setting.vendor === "opencode-zen" ? "big-pickle" : "Enter the provider model slug"}
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
          const taskPrefSelectClass =
            "h-9 w-full rounded-none border-2 border-yellow-400 bg-zinc-100 px-3 text-sm text-zinc-950 shadow-[3px_3px_0_0_rgba(234,179,8,1)] focus:outline-none dark:bg-zinc-950 dark:text-zinc-50";
          const taskPrefs = [
            { id: "textImprove", label: "Text improvement", value: prefTextImprove, onChange: setPrefTextImprove },
            { id: "altText", label: "Visual descriptions", value: prefAltText, onChange: setPrefAltText },
            { id: "artPiece", label: "Art pieces", value: prefArtPiece, onChange: setPrefArtPiece },
          ];
          return (
            <Card className="border-2 border-yellow-400 bg-zinc-50 text-zinc-950 shadow-[6px_6px_0_0_rgba(0,0,0,0.95)] dark:bg-zinc-950 dark:text-zinc-50">
              <CardHeader>
                <CardTitle>Task Preferences</CardTitle>
                <CardDescription className="text-zinc-700 dark:text-zinc-300">
                  Set a default vendor per task so you are not prompted each time. Only enabled vendors appear here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {taskPrefs.map(({ id, label, value, onChange }) => (
                  <div key={id} className="grid gap-2 md:grid-cols-[180px_1fr]">
                    <Label htmlFor={`task-pref-${id}`} className="flex items-center text-sm font-medium">{label}</Label>
                    <select
                      id={`task-pref-${id}`}
                      value={value}
                      onChange={(e) => onChange(e.target.value)}
                      className={taskPrefSelectClass}
                    >
                      <option value={TASK_PREF_NONE}>None (ask each time)</option>
                      {enabledVendors.map((v) => (
                        <option key={v.vendor} value={v.vendor}>{v.vendorLabel}</option>
                      ))}
                    </select>
                  </div>
                ))}
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
