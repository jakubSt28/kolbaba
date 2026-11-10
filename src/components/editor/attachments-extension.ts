import { Extension } from "@tiptap/core";

export interface AttachmentsStorage {
  /** Set by the composer: uploads a picked or pasted image and puts it into the text. */
  insertImage: ((file: File) => void) | null;
}

declare module "@tiptap/core" {
  interface Storage {
    attachments: AttachmentsStorage;
  }
}

/** Lets editor commands (the "/" menu's Image) hand files to the composer, which uploads them to the draft. */
export const Attachments = Extension.create<object, AttachmentsStorage>({
  name: "attachments",
  addStorage() {
    return { insertImage: null };
  },
});
