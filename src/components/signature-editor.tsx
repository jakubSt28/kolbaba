"use client";

import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Download, Italic, Link as LinkIcon, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { api, LIVE } from "@/lib/live";
import { useMail } from "@/lib/store";
import type { Account } from "@/lib/types";
import { settle } from "./editor/settle";
import { cn } from "@/lib/utils";
import { Tooltip } from "./ui";

/**
 * The signature under every email from this mailbox: written here like any email (bold, links, a
 * logo that's already in it), or brought over from Gmail. Saved as you type.
 */
export function SignatureEditor({ account }: { account: Account }) {
  const updateAccount = useMail((s) => s.updateAccount);
  const pushToast = useMail((s) => s.pushToast);
  const [importing, setImporting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      Image,
      Placeholder.configure({ placeholder: t("Your name, phone, a link… whatever should end every email") }),
    ],
    content: account.signature,
    onMount: settle,
    editorProps: { attributes: { class: "editor-root min-h-[72px] outline-none", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => updateAccount(account.id, { signature: editor.isEmpty ? "" : editor.getHTML() }), 400);
    },
  });

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const importFromGmail = async () => {
    if (!editor) return;
    setImporting(true);
    try {
      const { html } = await api.get<{ html: string }>(`/api/accounts/${account.id}/signature`);
      if (!html) {
        pushToast({ message: t("There's no signature in Gmail for {email}.", { email: account.email }) });
        return;
      }
      editor.commands.setContent(html);
      updateAccount(account.id, { signature: editor.isEmpty ? "" : editor.getHTML() });
      pushToast({ message: t("Signature brought over from Gmail") });
    } catch (err) {
      pushToast({ message: (err as Error).message });
    } finally {
      setImporting(false);
    }
  };

  const toggleLink = () => {
    if (!editor) return;
    if (editor.isActive("link")) return void editor.chain().focus().unsetLink().run();
    const url = window.prompt(t("Link address"), "https://");
    if (url && url !== "https://") editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const tool = (active: boolean) =>
    cn("flex size-7 items-center justify-center rounded-md transition-colors", active ? "bg-selected text-ink" : "text-ink-3 hover:bg-hover hover:text-ink");

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-1">
        <Tooltip label={t("Bold")} side="top">
          <button aria-label={t("Bold")} onClick={() => editor?.chain().focus().toggleBold().run()} className={tool(!!editor?.isActive("bold"))}>
            <Bold size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t("Italic")} side="top">
          <button aria-label={t("Italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} className={tool(!!editor?.isActive("italic"))}>
            <Italic size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t("Link")} side="top">
          <button aria-label={t("Link")} onClick={toggleLink} className={tool(!!editor?.isActive("link"))}>
            <LinkIcon size={14} />
          </button>
        </Tooltip>
        {LIVE && account.provider === "gmail" && (
          <button
            onClick={() => void importFromGmail()}
            disabled={importing}
            className="ml-auto flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-accent-text transition-colors hover:bg-accent-soft disabled:opacity-60"
          >
            {importing ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />}
            {t("Bring over from Gmail")}
          </button>
        )}
      </div>
      <div className="editor rounded-[10px] bg-hover px-3 py-2.5 text-[14px] leading-relaxed [&_img]:max-h-24 [&_img]:w-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
