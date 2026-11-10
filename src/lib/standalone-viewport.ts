/**
 * Home Screen apps on iOS 26 can start under the status bar with a web view one status bar too short
 * (WebKit bug 301108): innerHeight is the screen minus the top inset, and the strip below it can't be
 * painted at all, whatever the CSS. The home indicator then sits in that strip, outside the page, so
 * the page shouldn't keep its own bottom inset free as well. Marks <html data-short-viewport>, which
 * zeroes --safe-bottom (globals.css).
 */
export function watchShortViewport() {
  if (typeof window === "undefined") return () => {};
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!standalone) return () => {};

  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;height:env(safe-area-inset-top);width:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);

  const update = () => {
    const insetTop = probe.getBoundingClientRect().height;
    // iOS reports the screen in portrait whatever the orientation.
    const landscape = window.matchMedia("(orientation: landscape)").matches;
    const screenHeight = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    const short = insetTop > 0 && Math.abs(screenHeight - insetTop - window.innerHeight) <= 1;
    document.documentElement.toggleAttribute("data-short-viewport", short);
  };
  update();
  // The inset and the viewport settle a moment after launch and after rotating.
  const later = setTimeout(update, 300);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  return () => {
    clearTimeout(later);
    window.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    probe.remove();
  };
}
