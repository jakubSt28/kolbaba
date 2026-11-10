"use client";

import {
  Briefcase,
  Code,
  Coffee,
  Globe,
  GraduationCap,
  Heart,
  House,
  Leaf,
  Mail,
  Palette,
  Plane,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { Tooltip as RTooltip } from "radix-ui";
import { forwardRef, useState, type CSSProperties, type ReactNode } from "react";
import { t, tk } from "@/lib/i18n";
import { LIVE } from "@/lib/live";
import type { MailboxIconName, Person } from "@/lib/types";
import { cn, hashHue, initials } from "@/lib/utils";

export const spring = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const;
export const softSpring = { type: "spring", stiffness: 300, damping: 32 } as const;

export const MAILBOX_ICONS: Record<MailboxIconName, LucideIcon> = {
  mail: Mail,
  user: User,
  briefcase: Briefcase,
  home: House,
  heart: Heart,
  star: Star,
  rocket: Rocket,
  coffee: Coffee,
  sparkles: Sparkles,
  globe: Globe,
  "shopping-bag": ShoppingBag,
  "graduation-cap": GraduationCap,
  plane: Plane,
  palette: Palette,
  code: Code,
  leaf: Leaf,
};

/** What each mailbox icon shows, for screen readers. English; show with t(). */
export const MAILBOX_ICON_LABELS: Record<MailboxIconName, string> = {
  mail: tk("Envelope"),
  user: tk("Person"),
  briefcase: tk("Briefcase"),
  home: tk("House"),
  heart: tk("Heart"),
  star: tk("Star"),
  rocket: tk("Rocket"),
  coffee: tk("Coffee"),
  sparkles: tk("Sparkles"),
  globe: tk("Globe"),
  "shopping-bag": tk("Shopping bag"),
  "graduation-cap": tk("Graduation cap"),
  plane: tk("Plane"),
  palette: tk("Palette"),
  code: tk("Code"),
  leaf: tk("Leaf"),
};

export function hueStyle(hue: number): CSSProperties {
  return { ["--h" as string]: hue };
}

export function MailboxBadge({
  icon,
  hue,
  image,
  size = 22,
  className,
}: {
  icon: MailboxIconName;
  hue: number;
  image?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = MAILBOX_ICONS[icon] ?? Mail;
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className={cn("inline-block shrink-0 rounded-[7px] object-cover shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn("hue-tint inline-flex shrink-0 items-center justify-center rounded-[7px]", className)}
      style={{ ...hueStyle(hue), width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.6)} strokeWidth={2} />
    </span>
  );
}

/** Live logos go through our server, so the icon service never sees the user's IP. The prototype's made-up senders load directly. */
export const logoSrc = (domain: string) => (LIVE ? `/api/icons/${domain}` : `https://icons.duckduckgo.com/ip3/${domain}.ico`);

export function Avatar({
  person,
  logo,
  size = 36,
  className,
}: {
  person: Person;
  logo?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const hue = hashHue(person.email);
  const showLogo = logo && !failed;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium select-none",
        showLogo ? "bg-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)] dark:bg-white/90" : "hue-tint",
        className,
      )}
      style={{ ...hueStyle(hue), width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc(logo)}
          alt=""
          width={Math.round(size * 0.55)}
          height={Math.round(size * 0.55)}
          onError={() => setFailed(true)}
          className="rounded-[4px]"
        />
      ) : (
        // No name: the address's own words ("petra.novakova@…" → PN).
        initials(person.name || person.email.split("@")[0].replace(/[._-]+/g, " "))
      )}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 font-sans text-[10.5px] font-medium text-ink-3 shadow-[inset_0_0_0_0.5px_var(--line)] bg-hover",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** The × at the end of a search field with text in it: empties the field and leaves the caret there. */
export function ClearSearch({ onClear, size = 16 }: { onClear: () => void; size?: number }) {
  return (
    <button
      type="button"
      aria-label={t("Clear search")}
      // Keep the caret where it is (a click would move focus to the button).
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        onClear();
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      className="-mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink-2"
    >
      <span className="flex items-center justify-center rounded-full bg-current" style={{ width: size, height: size }}>
        <X size={Math.round(size * 0.62)} strokeWidth={3} className="text-solid" />
      </span>
    </button>
  );
}

export function Tooltip({ label, shortcut, children, side = "bottom" }: { label: string; shortcut?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="glass-strong z-50 flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] text-ink data-[state=delayed-open]:animate-[menu-in_120ms_ease-out]"
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean; tooltipSide?: "top" | "bottom" }
>(function IconButton({ label, shortcut, active, className, children, tooltipSide, ...props }, ref) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        aria-label={label}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full text-ink-2 press [--press-scale:0.9] hover:bg-hover hover:text-ink",
          active && "text-accent-text",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
});

export const menuContentClass =
  "glass-strong z-50 min-w-[200px] rounded-xl p-1 text-[13px] text-ink origin-[var(--radix-dropdown-menu-content-transform-origin)] data-[state=open]:animate-[menu-in_140ms_ease-out]";

export const menuItemClass =
  "flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-on-accent data-[disabled]:opacity-40";

/** A menu item that opens a submenu: while it's open it stays lit, and in the accent only while pointed at (its text is on-accent then). */
export const subTriggerClass = `${menuItemClass} data-[state=open]:bg-hover data-[state=open]:data-[highlighted]:bg-accent`;

/** A small segmented switch (two or three choices), with the selection sliding between them. */
export function Segmented<T extends string>({
  id,
  value,
  options,
  onChange,
  full,
}: {
  id: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  /** As wide as its row; each choice gets what its label needs and an equal share of the rest. */
  full?: boolean;
}) {
  return (
    <div className={cn("relative grid shrink-0 grid-flow-col rounded-[10px] bg-hover p-0.5 text-[13px]", full ? "w-full auto-cols-auto" : "auto-cols-fr")}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cn("press relative h-7 rounded-[8px] whitespace-nowrap [--press-scale:0.95]", full ? "px-1.5" : "px-3")}>
          {value === o.value && (
            <motion.span
              layoutId={`segmented-${id}`}
              transition={spring}
              className="absolute inset-0 rounded-[8px] bg-solid shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_var(--line)]"
            />
          )}
          <span className={cn("relative inline-flex items-center gap-1.5", value === o.value ? "font-medium text-ink" : "text-ink-2")}>
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}
