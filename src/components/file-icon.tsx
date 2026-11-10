import { CalendarDays, FileArchive, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";

const ATTACHMENT_ICONS = {
  pdf: FileText,
  image: FileImage,
  doc: FileText,
  sheet: FileSpreadsheet,
  zip: FileArchive,
  calendar: CalendarDays,
} satisfies Record<Attachment["kind"], unknown>;

/** A file's kind at a glance: PDFs red, sheets green, pictures amber, the rest in the app's colour. */
export function FileIcon({ kind, size = 36 }: { kind: Attachment["kind"]; size?: number }) {
  const Icon = ATTACHMENT_ICONS[kind];
  const tone =
    kind === "pdf"
      ? "bg-danger/12 text-danger"
      : kind === "sheet"
        ? "bg-success/12 text-success"
        : kind === "image"
          ? "bg-warning/15 text-warning"
          : "bg-accent-soft text-accent-text";
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg", tone)} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.47)} />
    </span>
  );
}
