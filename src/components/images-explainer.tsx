"use client";

import { Dialog } from "radix-ui";
import { t } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import { Toggle } from "./settings";
import { ImagesPreview } from "./settings-previews";

/**
 * Why images are hidden, at a glance: the picture, one sentence, and the same switch as in Settings
 * (the picture follows it). Opens by itself on the first email with blocked images, and from the
 * notice above any of them.
 */
export function ImagesExplainerHost() {
  const open = useMail((s) => s.imagesExplainerOpen);
  const close = useMail((s) => s.closeImagesExplainer);
  const load = useMail((s) => s.loadRemoteImages);
  const setLoad = useMail((s) => s.setLoadRemoteImages);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-[fade-in_140ms_ease-out] dark:bg-black/45" />
        <Dialog.Content className="glass-strong fixed inset-x-3 bottom-[max(12px,var(--safe-bottom))] z-50 mx-auto max-h-[calc(100dvh-24px)] max-w-[380px] overflow-y-auto rounded-[26px] p-5 outline-none data-[state=open]:animate-[menu-in_180ms_ease-out] sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
          <ImagesPreview load={load} />
          <Dialog.Title className="mt-4 text-[18px] font-semibold tracking-[-0.02em]">{t("Images are hidden on purpose")}</Dialog.Title>
          <Dialog.Description className="mt-1 text-[14px] leading-relaxed text-ink-2">
            {t("Many emails hide invisible images that tell the sender when and where you read them. Kolbaba blocks them.")}
          </Dialog.Description>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-[14px] bg-hover px-3.5 py-3">
            <span className="text-[14px] font-medium text-ink">{t("Load images automatically")}</span>
            <Toggle on={load} label={t("Load images automatically")} onChange={setLoad} />
          </div>
          <button
            autoFocus
            onClick={close}
            className="press mt-3 h-11 w-full rounded-full bg-accent text-[14.5px] font-medium text-on-accent [--press-scale:0.97] hover:bg-accent-hover"
          >
            {t("Got it")}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
