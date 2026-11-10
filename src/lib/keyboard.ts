/**
 * The on-screen keyboard on a phone. iOS doesn't make the page smaller for it: the keyboard covers the
 * bottom of the screen, and iOS slides the whole screen up until the field being typed in shows. A new
 * email focused while its sheet was still sliding in got pushed up by a whole keyboard that way, header
 * and recipient off the top; a reply's text and Send stayed under the keyboard.
 *
 * While a keyboard is up, <html data-keyboard> and --visible-top / --visible-height give the area left
 * above it, and the phone shell takes exactly that area (globals.css): bars at the bottom sit on the
 * keyboard, the header stays at the top. onKeyboard() tells a screen when that area changed, so it can
 * bring back into view what's being typed in.
 */

/** Less than this covered is a toolbar coming and going, not a keyboard (an iPhone keyboard is 250pt and up). */
const MIN_KEYBOARD = 80;

export interface VisibleArea {
  top: number;
  height: number;
}

/**
 * The part of the page a keyboard leaves visible, or null when no keyboard is up. Pure, for the tests.
 * `wasUp`: a keyboard already up stays up while the area stays small, even with nothing focused for a
 * moment as the focus moves from one field to the next; dropping it then made the screen jump.
 */
export function areaAboveKeyboard(v: { fullHeight: number; height: number; offsetTop: number; scale: number; typing: boolean; wasUp?: boolean }): VisibleArea | null {
  // Zoomed in, the visible part is small because of the zoom, not a keyboard.
  if ((!v.typing && !v.wasUp) || v.scale > 1.01) return null;
  if (v.fullHeight - v.height < MIN_KEYBOARD) return null;
  return { top: Math.max(0, Math.round(v.offsetTop)), height: Math.round(v.height) };
}

/** After the focus moves to another field, how long the keyboard has to settle before the shell follows it. */
export const SETTLE_MS = 350;

/**
 * Whether to wait before following the keyboard. Moving from one field to the next (the subject, then the
 * text), iOS reloads the keyboard: for a moment it changes height, or drops away and comes back. Following
 * that made the whole screen jump down and up; the shell waits for where it settles. Pure, for the tests.
 */
export function settling(v: { was: VisibleArea | null; next: VisibleArea | null; sinceFocus: number; typing: boolean }) {
  return !!v.was && v.typing && v.sinceFocus < SETTLE_MS && v.next?.height !== v.was.height;
}

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);

/** Something the keyboard types into has the focus: only then is a smaller visible area a keyboard. */
function typing(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type);
}

/** Fields, which a tap focuses: text, a date, a select. */
const FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** A touch that moved more than this, or lasted longer, is a scroll or a long press, not a tap. */
const TAP_MOVE = 10;
const TAP_MS = 500;

/**
 * The text field a tap lands in, when it isn't the one already typed in. Moving to another field while
 * the keyboard is up, iOS scrolls the page to put that field in the middle of what the keyboard leaves
 * visible (always, because of its ˄ ˅ ✓ bar), unless the field was focused with preventScroll. The shell
 * follows a frame later, so the whole screen jumped down and back up at every tap between the subject
 * and the text. Focused by us first, iOS leaves the page where it is, and the tap only places the caret.
 */
function tappedField(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const field = target.closest<HTMLElement>(FIELDS);
  if (!field || !typing(field) || field.contains(document.activeElement)) return null;
  if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && (field.disabled || field.readOnly)) return null;
  return field;
}

/**
 * For onMouseDown on a bar of buttons next to the text (the composer's Send, Remind, Insert block…) and
 * on the menus they open. A tap on a button took the focus away from the text: the keyboard went down
 * and the bar dropped with it. While a keyboard is up the focus now stays in the text; a field (the date
 * in Schedule send) still takes it.
 */
export function keepTyping(e: { target: EventTarget | null; preventDefault(): void }) {
  if (!current || (e.target instanceof Element && e.target.closest(FIELDS))) return;
  e.preventDefault();
}

function keepTypingFocus(e: Event) {
  if (current) e.preventDefault();
}

/**
 * For the Content of a Radix menu opened from such a bar: while a keyboard is up it doesn't take the focus
 * when it opens, or hand it to its button when it closes, and taps on it are kept as above. onOpenAutoFocus
 * isn't in DropdownMenu's types, but its Menu passes it on to the focus scope (radix-ui 1.7); if that
 * ever stops, the keyboard only goes down again.
 */
export const keepTypingMenu = { onOpenAutoFocus: keepTypingFocus, onCloseAutoFocus: keepTypingFocus, onMouseDown: keepTyping } as {
  onCloseAutoFocus: (e: Event) => void;
  onMouseDown: typeof keepTyping;
};

const listeners = new Set<() => void>();
let current: VisibleArea | null = null;

/** Called after a keyboard comes up, or changes height while up (a different keyboard, the suggestions bar). */
export function onKeyboard(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function watchKeyboard() {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  let focusedAt = -Infinity;
  let wait: ReturnType<typeof setTimeout> | undefined;
  const onFocus = () => void (focusedAt = performance.now());

  const update = () => {
    const isTyping = typing(document.activeElement);
    const next = areaAboveKeyboard({
      // The page's own height: iOS keeps it when the keyboard comes up (one of the two may follow the keyboard).
      fullHeight: Math.max(root.clientHeight, window.innerHeight),
      height: vv.height,
      offsetTop: vv.offsetTop,
      scale: vv.scale,
      typing: isTyping,
      wasUp: current !== null,
    });
    const was = current;
    clearTimeout(wait);
    const sinceFocus = performance.now() - focusedAt;
    if (settling({ was, next, sinceFocus, typing: isTyping })) {
      // Looked at again once it has settled. Meanwhile only the top follows iOS sliding the page.
      wait = setTimeout(update, SETTLE_MS - sinceFocus);
      if (was && next && next.top !== was.top) {
        current = { top: next.top, height: was.height };
        root.style.setProperty("--visible-top", `${next.top}px`);
      }
      return;
    }
    current = next;
    if (next) {
      root.style.setProperty("--visible-top", `${next.top}px`);
      root.style.setProperty("--visible-height", `${next.height}px`);
      root.setAttribute("data-keyboard", "");
    } else if (was) {
      root.removeAttribute("data-keyboard");
      root.style.removeProperty("--visible-top");
      root.style.removeProperty("--visible-height");
      // iOS can leave the page slid up after the keyboard goes; the shell is fixed, nothing should be scrolled.
      if (window.scrollY) window.scrollTo(0, 0);
    }
    // Only a new height matters to the screens; the top moves on its own while iOS slides the page.
    // Right away: what they measure is laid out with the new area as soon as they ask.
    if (next && next.height !== was?.height) listeners.forEach((fn) => fn());
  };

  // The keyboard coming, going or changing height resizes the visible area, after the focus has moved.
  // (Not focusin/focusout: between two fields the focus is nowhere for a moment and the shell would jump.)
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  document.addEventListener("focusin", onFocus);

  // A tap into another field while the keyboard is up (tappedField): focused before iOS gets to it.
  let touch: { x: number; y: number; at: number } | null = null;
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches.length === 1 ? e.touches[0] : null;
    touch = t ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch;
    const t = e.changedTouches[0];
    touch = null;
    if (!current || !start || !t || e.timeStamp - start.at > TAP_MS) return;
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_MOVE) return;
    tappedField(e.target)?.focus({ preventScroll: true });
  };
  const touchOptions = { capture: true, passive: true };
  document.addEventListener("touchstart", onTouchStart, touchOptions);
  document.addEventListener("touchend", onTouchEnd, touchOptions);

  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("touchstart", onTouchStart, touchOptions);
    document.removeEventListener("touchend", onTouchEnd, touchOptions);
    clearTimeout(wait);
    current = null;
    root.removeAttribute("data-keyboard");
    root.style.removeProperty("--visible-top");
    root.style.removeProperty("--visible-height");
  };
}

/**
 * Scrolls the nearest scrolling box around `el` so `el` ends right at its bottom, on top of the keyboard,
 * or at its top when it's taller than the box. Never the page itself: on a phone that's the fixed shell.
 */
export function alignAboveKeyboard(el: HTMLElement) {
  let box = el.parentElement;
  while (box && box !== document.body) {
    const { overflowY } = getComputedStyle(box);
    if ((overflowY === "auto" || overflowY === "scroll") && box.scrollHeight > box.clientHeight) break;
    box = box.parentElement;
  }
  if (!box || box === document.body) return;
  const outer = box.getBoundingClientRect();
  const inner = el.getBoundingClientRect();
  box.scrollTop += inner.height <= outer.height ? inner.bottom - outer.bottom : inner.top - outer.top;
}
