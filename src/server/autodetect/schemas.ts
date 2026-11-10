import { z } from "zod";
import { tk } from "@/lib/i18n";

const email = z.string().trim().max(254).pipe(z.email({ error: tk("That doesn't look like an email address") }));

const serverConfig = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, { error: tk("That server name doesn't look right") }),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320).optional(),
});

export const detectBody = z.object({ email });

export const testBody = z.object({
  email,
  password: z.string().min(1, { error: tk("Enter your password") }).max(1024),
  imap: serverConfig.optional(),
  smtp: serverConfig.optional(),
});

