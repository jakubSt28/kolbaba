"use client";

import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Plus, TextQuote } from "lucide-react";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { useMail } from "@/lib/store";
import type { Snippet } from "@/lib/types";
import { settle } from "./editor/settle";
import { cn, htmlToText } from "@/lib/utils";
import { Group, Row } from "./settings";

const button = "h-8 shrink-0 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink transition-colors hover:bg-selected";

/** Settings → Mail: templates and snippets, inserted with "/" while writing. */
export function SnippetSettings() {
  const snippets = useMail((s) => s.snippets);
  const [editing, setEditing] = useState<Snippet | "new" | null>(null);
  return (
    <Group title={t("Snippets")} info={t("Type / in an email and pick one, or start typing its name. Select text in an email to save it as a snippet.")}>
      {snippets.map((s) =>
        editing !== "new" && editing?.id === s.id ? (
          <SnippetForm key={s.id} snippet={s} onDone={() => setEditing(null)} />
        ) : (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => setEditing(s)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setEditing(s)}
            className="block w-full cursor-pointer text-left transition-colors outline-none hover:bg-hover focus-visible:bg-hover"
          >
            <Row
              label={
                <span className="flex items-center gap-2">
                  <TextQuote size={14} className="text-ink-3" />
                  {s.name}
                </span>
              }
              hint={<span className="line-clamp-1">{htmlToText(s.html) || t("Empty")}</span>}
            />
          </div>
        ),
      )}
      {editing === "new" ? (
        <SnippetForm onDone={() => setEditing(null)} />
      ) : (
        <Row label={snippets.length ? t("New snippet") : t("No snippets yet")} hint={snippets.length ? undefined : t("A greeting, a price list, directions to the office…")}>
          <button onClick={() => setEditing("new")} className={cn(button, "flex items-center gap-1.5")}>
            <Plus size={14} />
            {t("Add")}
          </button>
        </Row>
      )}
    </Group>
  );
}

function SnippetForm({ snippet, onDone }: { snippet?: Snippet; onDone: () => void }) {
  const saveSnippet = useMail((s) => s.saveSnippet);
  const deleteSnippet = useMail((s) => s.deleteSnippet);
  const [name, setName] = useState(snippet?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false }), Placeholder.configure({ placeholder: t("What gets inserted…") })],
    content: snippet?.html ?? "",
    onMount: settle,
    editorProps: { attributes: { class: "editor-root min-h-[72px] text-[13.5px]" } },
  });

  const save = async () => {
    if (!name.trim()) {
      setError(t("Give it a name"));
      return;
    }
    setBusy(true);
    try {
      await saveSnippet({ id: snippet?.id, name: name.trim(), html: editor?.isEmpty ? "" : (editor?.getHTML() ?? "") });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5 p-4">
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && editor?.commands.focus("end")}
        placeholder={t("Name, e.g. “Price list”")}
        aria-label={t("Name")}
        autoFocus={!snippet}
        maxLength={80}
        className="h-9 w-full rounded-[10px] bg-canvas px-3 text-[13.5px] font-medium shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
      />
      <div className="editor rounded-[10px] bg-canvas px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
        <EditorContent editor={editor} />
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        {snippet && (
          <button
            onClick={() => {
              deleteSnippet(snippet.id);
              onDone();
            }}
            className="h-8 rounded-[10px] px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger/8"
          >
            {t("Delete")}
          </button>
        )}
        <span className="flex-1" />
        <button onClick={onDone} className="h-8 rounded-[10px] bg-hover px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-selected">
          {t("Cancel")}
        </button>
        <button onClick={() => void save()} disabled={busy} className="h-8 rounded-[10px] bg-accent px-3 text-[13px] font-medium text-on-accent transition-opacity disabled:opacity-50">
          {t("Save")}
        </button>
      </div>
    </div>
  );
}
