import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { tk } from "@/lib/i18n";

const b64url = z.string().min(1).max(16_384).regex(/^[A-Za-z0-9_-]+=*$/, "Invalid encoding");

const credentialBase = {
  id: b64url,
  rawId: b64url,
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
};

export const registrationResponseSchema = z.looseObject({
  ...credentialBase,
  response: z.looseObject({
    clientDataJSON: b64url,
    attestationObject: b64url,
    authenticatorData: b64url.optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: b64url.optional(),
  }),
}) as unknown as z.ZodType<RegistrationResponseJSON>;

export const authenticationResponseSchema = z.looseObject({
  ...credentialBase,
  response: z.looseObject({
    clientDataJSON: b64url,
    authenticatorData: b64url,
    signature: b64url,
    userHandle: b64url.optional(),
  }),
}) as unknown as z.ZodType<AuthenticationResponseJSON>;

export const emailCodeBody = z.object({
  email: z.string().trim().max(254).pipe(z.email({ error: tk("That doesn't look like an email address") })),
});

export const codeBody = z.object({
  code: z.string().trim().min(6).max(12),
  next: z.string().max(2048).optional(),
});

export const createAccountBody = z.object({
  name: z.string().trim().max(80, { error: tk("That name is a little long") }).default(""),
  next: z.string().max(2048).optional(),
});

export const registerVerifyBody = z.object({
  response: registrationResponseSchema,
  next: z.string().max(2048).optional(),
});

export const loginVerifyBody = z.object({
  response: authenticationResponseSchema,
  next: z.string().max(2048).optional(),
});
