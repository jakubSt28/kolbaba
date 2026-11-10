/**
 * The sidebar as the user arranged it: the order of its sections, the order of the items in each, and
 * what they put away into "More". Saved with the user's settings, so every device shows the same.
 * Pure functions here; src/components/sidebar.tsx draws the result.
 */

export type SidebarSectionId = "folders" | "categories" | "mine" | "agents";

export interface SidebarLayout {
  sections?: SidebarSectionId[];
  order?: Partial<Record<SidebarSectionId, string[]>>;
  /** Items put away into "More" (Inbox can't be). Unset: Spam and Trash. */
  hidden?: string[];
}

export const SECTION_ORDER: SidebarSectionId[] = ["folders", "categories", "mine", "agents"];

/** Put away until the user takes them out. */
export const DEFAULT_HIDDEN = ["spam", "trash"];

/** Go to "More" on their own while there's nothing in them. */
export const AUTO_HIDE = ["unanswered", "drafts", "snoozed", "scheduled"];

/** Always in sight. */
export const PERMANENT = ["inbox"];

export interface ArrangedItem {
  id: string;
  /** In "More" (put away, or empty and allowed to step aside). */
  away: boolean;
  /** Put away by the user (rather than just empty). */
  hidden: boolean;
}

export interface ArrangedSection {
  id: SidebarSectionId;
  items: ArrangedItem[];
}

/** `order` first (known ids only), then whatever it doesn't mention, in the default order. */
export function ordered<T extends string>(order: readonly string[] | undefined, available: readonly T[]): T[] {
  const known = new Set<string>(available);
  const first = (order ?? []).filter((id): id is T => known.has(id));
  const seen = new Set<string>(first);
  return [...first, ...available.filter((id) => !seen.has(id))];
}

export function hiddenSet(layout: SidebarLayout): Set<string> {
  return new Set((layout.hidden ?? DEFAULT_HIDDEN).filter((id) => !PERMANENT.includes(id)));
}

/**
 * The sidebar to draw. `available` is what exists per section in its default order (categories only
 * when they're on, the user's own folders…); `counts` decides which empty ones step aside.
 */
export function arrange(
  layout: SidebarLayout,
  available: Record<SidebarSectionId, readonly string[]>,
  counts: Partial<Record<string, number>>,
): ArrangedSection[] {
  const hidden = hiddenSet(layout);
  return ordered(layout.sections, SECTION_ORDER).map((id) => ({
    id,
    items: ordered(layout.order?.[id], available[id]).map((item) => {
      const put = hidden.has(item);
      return { id: item, hidden: put, away: put || (AUTO_HIDE.includes(item) && !counts[item]) };
    }),
  }));
}

/** Show or put away one item. */
export function toggleHidden(layout: SidebarLayout, id: string): SidebarLayout {
  if (PERMANENT.includes(id)) return layout;
  const hidden = hiddenSet(layout);
  if (hidden.has(id)) hidden.delete(id);
  else hidden.add(id);
  return { ...layout, hidden: [...hidden] };
}

export function reorderSection(layout: SidebarLayout, section: SidebarSectionId, items: string[]): SidebarLayout {
  return { ...layout, order: { ...layout.order, [section]: items } };
}

export function reorderSections(layout: SidebarLayout, sections: SidebarSectionId[]): SidebarLayout {
  return { ...layout, sections };
}
