"use client";

import { useState, useTransition } from "react";
import { Plus, Check, Loader2, Circle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  setStageStatusAction,
  addStageAction,
} from "@/app/(admin)/admin/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ProjectStage, StageStatus } from "@/lib/database.types";

const STATUS_CYCLE: StageStatus[] = ["pending", "in_progress", "completed"];

export function StageManager({
  clientId,
  stages,
}: {
  clientId: string;
  stages: ProjectStage[];
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function cycle(stage: ProjectStage) {
    const idx = STATUS_CYCLE.indexOf(stage.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setBusyId(stage.id);
    startTransition(async () => {
      await setStageStatusAction(stage.id, clientId, next);
      setBusyId(null);
    });
  }

  function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("client_id", clientId);
    setAdding(true);
    startTransition(async () => {
      await addStageAction(formData);
      form.reset();
      setAdding(false);
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {[...stages]
          .sort((a, b) => a.position - b.position)
          .map((stage) => (
            <li
              key={stage.id}
              className="flex items-center gap-3 rounded-xl border border-ink-100 p-3"
            >
              <button
                onClick={() => cycle(stage)}
                disabled={pending && busyId === stage.id}
                className="shrink-0"
                title="Click to cycle status"
              >
                <StageDot status={stage.status} busy={pending && busyId === stage.id} />
              </button>
              <div className="flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    stage.status === "pending" ? "text-ink-500" : "text-ink-900"
                  )}
                >
                  {stage.name}
                </p>
                {stage.description && (
                  <p className="text-xs text-ink-400">{stage.description}</p>
                )}
              </div>
              <span className="text-xs font-medium capitalize text-ink-400">
                {stage.status.replace("_", " ")}
              </span>
            </li>
          ))}
      </ul>

      <form onSubmit={add} className="flex gap-2">
        <Input name="name" placeholder="Add a stage (e.g. Content Review)" required />
        <Button type="submit" variant="outline" loading={adding}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
    </div>
  );
}

function StageDot({ status, busy }: { status: StageStatus; busy: boolean }) {
  if (busy)
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    );
  if (status === "completed")
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-white">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-600">
        <Clock className="h-4 w-4" />
      </span>
    );
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink-200 text-ink-300">
      <Circle className="h-3 w-3" />
    </span>
  );
}
