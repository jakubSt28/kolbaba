/**
 * Dragging conversations from the list onto a folder in the sidebar (computer only). The ids travel
 * in the drag's own data type, so nothing else on the page (or outside it) mistakes them for text.
 */
export const THREADS_TYPE = "application/x-kolbaba-threads";

export function startThreadDrag(e: React.DragEvent, ids: string[], label: string) {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(THREADS_TYPE, JSON.stringify(ids));
  // A small pill under the pointer instead of a see-through copy of the whole row.
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = label;
  document.body.append(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  setTimeout(() => ghost.remove(), 0);
}

export const isThreadDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(THREADS_TYPE);

export function droppedThreads(e: React.DragEvent): string[] {
  try {
    const ids: unknown = JSON.parse(e.dataTransfer.getData(THREADS_TYPE));
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
