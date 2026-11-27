"use client";

import { motion } from "motion/react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { spring } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface AdminTab {
  id: string;
  label: string;
  /** A number next to the label (users, feedback…), so you can see what's in a tab without opening it. */
  count?: number;
  content: ReactNode;
}

/**
 * /admin in tabs instead of one long page. Everything is rendered on the server already, so switching
 * is instant; the tab goes into the address (?tab=) so a reload or a shared link opens the same one.
 */
export function AdminTabs({ tabs, initial }: { tabs: AdminTab[]; initial: string }) {
  const [active, setActive] = useState(tabs.some((t) => t.id === initial) ? initial : tabs[0].id);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (id: string) => {
    setActive(id);
    const url = new URL(window.location.href);
    if (id === tabs[0].id) url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  };

  // Arrow keys move between tabs, as in any tab list.
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + tabs.length) % tabs.length;
    select(tabs[next].id);
    buttons.current[next]?.focus();
  };

  return (
    <>
      <div role="tablist" className="no-scrollbar -mx-4 flex overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex shrink-0 rounded-[12px] bg-hover p-0.5 text-[13px]">
          {tabs.map((tab, i) => {
            const on = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                role="tab"
                id={`admin-tab-${tab.id}`}
                aria-selected={on}
                aria-controls={`admin-panel-${tab.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => select(tab.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className="press relative h-8 rounded-[10px] px-3 whitespace-nowrap [--press-scale:0.96]"
              >
                {on && (
                  <motion.span
                    layoutId="admin-tab"
                    transition={spring}
                    className="absolute inset-0 rounded-[10px] bg-solid shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_var(--line)]"
                  />
                )}
                <span className={cn("relative inline-flex items-center gap-1.5", on ? "font-medium text-ink" : "text-ink-2")}>
                  {tab.label}
                  {tab.count !== undefined && <span className="text-[12px] text-ink-3 tabular-nums">{tab.count}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" id={`admin-panel-${tab.id}`} aria-labelledby={`admin-tab-${tab.id}`} hidden={tab.id !== active}>
          {tab.content}
        </div>
      ))}
    </>
  );
}
