import { z } from "zod";

/** What the app's error screen reports about a crash (src/lib/report-crash.ts). Everything is capped. */
export const ClientErrorBody = z.object({
  /** "page": the app or a page threw (src/app/error.tsx); "root": the frame around it (src/app/global-error.tsx). */
  where: z.enum(["page", "root"]),
  name: z.string().max(100).optional(),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  /** React's: the components from the one that threw up to the app (src/components/crash-screen.tsx). */
  componentStack: z.string().max(8000).optional(),
  digest: z.string().max(100).optional(),
  path: z.string().max(300),
  build: z.string().max(100),
  /** Running as the installed app (its own window or the Home Screen), not in a browser tab. */
  app: z.boolean(),
  viewport: z.string().max(20),
});
export type ClientError = z.infer<typeof ClientErrorBody>;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** An error's text can quote the data it choked on: email addresses stay out of the log. */
const scrub = (text: string) => text.replace(EMAIL, "[email]");

const lines = (text: string | undefined, max: number) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, max)
    .map(scrub);

/**
 * One log entry: where, which build, who (by id only), which window, then the error, the code it
 * came from and the components it happened in. Chrome starts the stack with the message again;
 * Safari doesn't.
 */
export function formatClientError(report: ClientError, ctx: { userId: string | null; userAgent: string | null }) {
  const title = `${report.name || "Error"}: ${report.message}`;
  const stack = report.stack?.startsWith(`${report.name || "Error"}:`) ? report.stack.slice(report.stack.indexOf("\n") + 1) : report.stack;
  const frames = lines(stack, 15);
  const components = lines(report.componentStack, 30);
  const head = [
    `[client-error] ${report.where}`,
    `build ${report.build}`,
    ctx.userId ? `user ${ctx.userId}` : "signed out",
    `${report.app ? "app" : "browser"} ${report.viewport}`,
    scrub(report.path),
    report.digest && `digest ${report.digest}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return [head, scrub(title).slice(0, 1000), ...frames, ...(components.length ? ["components:", ...components] : []), `UA ${ctx.userAgent ?? "unknown"}`].join("\n");
}
