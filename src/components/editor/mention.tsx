"use client";

import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { AtSign } from "lucide-react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/i18n";
import { LIVE, loadContacts } from "@/lib/live";
import { getContacts, useMail } from "@/lib/store";
import type { Person } from "@/lib/types";
import { track } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { Avatar } from "../ui";

/**
 * "@Petra" in the text adds Petra to the email: her first name goes into the sentence and her address
 * into To (or Cc, when To has someone already). Only after a space or at the start of a line, so an
 * address typed into the text ("petr@firma.cz") stays an address.
 */

interface MentionStorage {
  /** The composer adds the picked person to the recipients. */
  onPick: ((person: Person) => void) | null;
}

declare module "@tiptap/core" {
  interface Storage {
    mention: MentionStorage;
  }
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

async function people(query: string): Promise<Person[]> {
  const q = fold(query.trim());
  const { threads, accounts } = useMail.getState();
  const mine = new Set(accounts.map((a) => a.email.toLowerCase()));
  const remote = LIVE ? await loadContacts() : [];
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of [...remote, ...getContacts(threads, accounts)]) {
    const email = p.email.toLowerCase();
    if (seen.has(email) || mine.has(email)) continue;
    seen.add(email);
    // Any word of the name, or the address, starting with what's typed.
    const words = fold(`${p.name} ${p.email}`).split(/[\s@.]+/);
    if (q && !words.some((w) => w.startsWith(q)) && !fold(p.email).startsWith(q)) continue;
    out.push(p);
    if (out.length >= 6) break;
  }
  return out;
}

interface MenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MenuProps {
  items: Person[];
  command: (person: Person) => void;
  clientRect?: (() => DOMRect | null) | null;
}

const MentionMenu = forwardRef<MenuHandle, MenuProps>(function MentionMenu({ items, command, clientRect }, ref) {
  const [index, setIndex] = useState(0);
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setIndex(0);
  }
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[index]);
        return true;
      }
      return false;
    },
  }));

  const rect = clientRect?.();
  if (!rect || !items.length) return null;
  const below = rect.bottom + 280 < window.innerHeight;
  return createPortal(
    <div
      style={{
        position: "fixed",
        left: Math.min(rect.left, window.innerWidth - 288),
        top: below ? rect.bottom + 8 : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + 8,
      }}
      className="glass-strong z-50 w-[276px] rounded-xl p-1 animate-[menu-in_120ms_ease-out]"
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-ink-3">
        <AtSign size={11} /> {t("Add to the email")}
      </div>
      {items.map((p, i) => (
        <button
          key={p.email}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            command(p);
          }}
          className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === index ? "bg-accent text-on-accent" : "text-ink")}
        >
          <Avatar person={p} size={26} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{p.name || p.email}</span>
            <span className={cn("block truncate text-[11.5px]", i === index ? "text-on-accent/75" : "text-ink-3")}>{p.email}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
});

export const Mention = Extension.create<object, MentionStorage>({
  name: "mention",
  addStorage() {
    return { onPick: null };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      Suggestion<Person, Person>({
        editor: this.editor,
        char: "@",
        // Its own key: the "/" menu is a suggestion too.
        pluginKey: new PluginKey("mention"),
        allowSpaces: false,
        items: ({ query }) => people(query),
        command: ({ editor, range, props: person }) => {
          track("mention");
          // The first name reads naturally in a sentence ("@Petra, could you…").
          const name = person.name.trim().split(/\s+/)[0] || person.email.split("@")[0];
          editor.chain().focus().deleteRange(range).insertContent(`${name} `).run();
          storage.onPick?.(person);
        },
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null;
          return {
            onStart: (props: SuggestionProps<Person, Person>) => {
              renderer = new ReactRenderer(MentionMenu, { props: { items: props.items, command: props.command, clientRect: props.clientRect }, editor: props.editor });
            },
            onUpdate: (props: SuggestionProps<Person, Person>) => {
              renderer?.updateProps({ items: props.items, command: props.command, clientRect: props.clientRect });
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                renderer?.destroy();
                renderer = null;
                return true;
              }
              return renderer?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              renderer?.destroy();
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
