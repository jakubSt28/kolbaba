"use client";

import { CircleCheckBig, FileUp, LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState } from "react";
import { create } from "zustand";
import { t, tn } from "@/lib/i18n";
import { useTasks } from "@/lib/tasks/store";

const useImport = create<{ open: boolean }>(() => ({ open: false }));

export const openTickTickImport = () => useImport.setState({ open: true });

type Step = { kind: "pick" } | { kind: "busy" } | { kind: "done"; tasks: number; lists: number; skipped: number } | { kind: "error"; message: string };

/** Moving over from TickTick: how to get its backup, then the file. */
export function TickTickImportHost() {
  const open = useImport((s) => s.open);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const input = useRef<HTMLInputElement>(null);
  const close = () => {
    useImport.setState({ open: false });
    setStep({ kind: "pick" });
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setStep({ kind: "busy" });
    const result = await useTasks.getState().importTickTick(await file.text());
    setStep(typeof result === "string" ? { kind: "error", message: result } : { kind: "done", ...result });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && step.kind !== "busy" && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-[fade-in_160ms_ease-out]" />
        <Dialog.Content onOpenAutoFocus={(e) => e.preventDefault()} className="glass-strong fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[22px] p-5 text-ink shadow-[var(--shadow-float)] outline-none">
          <div className="mb-3 flex items-start gap-3">
            <Dialog.Title className="flex-1 text-[17px] font-semibold tracking-[-0.01em]">{t("Import from TickTick")}</Dialog.Title>
            {step.kind !== "busy" && (
              <Dialog.Close aria-label={t("Close")} className="-m-1 flex size-8 outline-none focus-visible:bg-hover items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink">
                <X size={16} />
              </Dialog.Close>
            )}
          </div>

          {step.kind === "done" ? (
            <div className="py-2 text-center">
              <CircleCheckBig size={30} strokeWidth={1.6} className="mx-auto mb-2 text-success" />
              <Dialog.Description className="text-[14px] leading-relaxed text-ink-2">
                {tn(step.tasks, "{n} task came over", "{n} tasks came over")}
                {step.lists > 0 && ` ${tn(step.lists, "into {n} new list", "into {n} new lists")}`}.
                {step.skipped > 0 && ` ${tn(step.skipped, "{n} was here already.", "{n} were here already.")}`}
              </Dialog.Description>
              <button onClick={close} className="press mt-4 h-10 w-full rounded-[12px] bg-accent text-[13.5px] font-medium text-on-accent [--press-scale:0.97] hover:bg-accent-hover">
                {t("Done")}
              </button>
            </div>
          ) : (
            <>
              <Dialog.Description asChild>
                <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-ink-2">
                  <li>{t("In TickTick on the web, open Settings → Account → Backup and click Generate backup. A CSV file downloads.")}</li>
                  <li>{t("Pick that file here. Your lists, folders, tasks done or not, days, priorities, descriptions and repeating tasks come over.")}</li>
                </ol>
              </Dialog.Description>
              <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">{t("Reminders, tags and kanban columns stay behind. Importing the same backup again adds only what's new.")}</p>
              {step.kind === "error" && <p className="mb-3 rounded-[10px] bg-danger/10 px-3 py-2 text-[13px] text-danger">{step.message}</p>}
              <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              <button
                onClick={() => input.current?.click()}
                disabled={step.kind === "busy"}
                className="press flex h-10 w-full items-center justify-center gap-2 rounded-[12px] bg-accent text-[13.5px] font-medium text-on-accent [--press-scale:0.97] hover:bg-accent-hover disabled:opacity-70"
              >
                {step.kind === "busy" ? <LoaderCircle size={16} className="animate-spin" /> : <FileUp size={16} />}
                {step.kind === "busy" ? t("Importing…") : t("Choose the backup file")}
              </button>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
