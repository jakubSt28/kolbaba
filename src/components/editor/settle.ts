import type { Editor } from "@tiptap/react";

/**
 * `onMount` for every editor: the plugins tidy the new text right away (StarterKit adds an empty
 * paragraph after a list or quote that ends it) instead of on its first transaction. In Safari that
 * first transaction can be the focus event's, which Tiptap's focus command sets off in the middle of
 * its own (it focuses the page element at once there); its own then no longer fits the text and
 * throws "Applying a mismatched transaction". Opening a draft that ended in a list crashed the Mac
 * app that way. Not an edit: no update to save, nothing to undo.
 */
export function settle({ editor }: { editor: Editor }) {
  editor.view.dispatch(editor.state.tr.setMeta("preventUpdate", true).setMeta("addToHistory", false));
}
