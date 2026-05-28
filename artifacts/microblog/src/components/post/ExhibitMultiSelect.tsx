import { useMemo, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, LayoutGrid, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useListExhibits,
  useCreateExhibit,
  getListExhibitsQueryKey,
  type ExhibitWithCounts,
} from "@workspace/api-client-react";

type ExhibitMultiSelectProps = {
  value: number[];
  onChange: (next: number[]) => void;
  allowCreate?: boolean;
};

export function ExhibitMultiSelect({
  value,
  onChange,
  allowCreate = true,
}: ExhibitMultiSelectProps) {
  const queryClient = useQueryClient();
  const list = useListExhibits({
    query: { queryKey: getListExhibitsQueryKey() },
  });
  const exhibits: ExhibitWithCounts[] = list.data?.exhibits ?? [];
  const [input, setInput] = useState("");

  const selectedIds = useMemo(() => new Set(value), [value]);
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const matches = useMemo(() => {
    if (!trimmed) return exhibits.filter((e) => !selectedIds.has(e.id)).slice(0, 8);
    return exhibits
      .filter((e) => !selectedIds.has(e.id) && e.name.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [exhibits, selectedIds, trimmed, lower]);

  const exactMatch = useMemo(
    () => exhibits.find((e) => e.name.toLowerCase() === lower),
    [exhibits, lower],
  );

  const createExhibit = useCreateExhibit({
    mutation: {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: getListExhibitsQueryKey() });
        onChange(Array.from(new Set([...value, created.id])));
        setInput("");
      },
    },
  });

  const selectedExhibits = value
    .map((id) => exhibits.find((e) => e.id === id))
    .filter((e): e is ExhibitWithCounts => Boolean(e));

  function toggle(id: number) {
    if (selectedIds.has(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  function remove(id: number) {
    onChange(value.filter((v) => v !== id));
  }

  function handleCreate() {
    if (!allowCreate || !trimmed || createExhibit.isPending) return;
    if (exactMatch) {
      if (!selectedIds.has(exactMatch.id)) toggle(exactMatch.id);
      setInput("");
      return;
    }
    createExhibit.mutate({ data: { name: trimmed } });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Backspace" && input.length === 0 && value.length > 0) {
      remove(value[value.length - 1]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-background px-3 py-2">
        <LayoutGrid className="h-4 w-4 text-muted-foreground shrink-0" />
        {selectedExhibits.map((e) => (
          <Badge
            key={e.id}
            variant="secondary"
            className="gap-1 cursor-pointer"
            onClick={() => remove(e.id)}
          >
            {e.name}
            <X className="h-3 w-3" />
          </Badge>
        ))}
        <Input
          type="text"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            value.length === 0
              ? "Add exhibits — type to filter, Enter to create"
              : "Add another…"
          }
          className="flex-1 min-w-[12rem] border-0 shadow-none focus-visible:ring-0 px-0"
        />
        {allowCreate && trimmed && !exactMatch ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCreate}
            disabled={createExhibit.isPending}
            className="gap-1 rounded-full"
          >
            <Plus className="h-3 w-3" /> Create "{trimmed}"
          </Button>
        ) : null}
      </div>
      {matches.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {matches.map((e) => (
            <Badge
              key={e.id}
              variant="outline"
              className="cursor-pointer hover:bg-accent"
              onClick={() => toggle(e.id)}
            >
              <LayoutGrid className="h-3 w-3 mr-1" />
              {e.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
