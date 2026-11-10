import { z } from "zod";

export const ContactBody = z.object({
  name: z.string().max(200).optional(),
  emails: z.array(z.string().max(320)).max(40).optional(),
  phone: z.string().max(100).optional(),
  company: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  links: z.array(z.string().max(500)).max(20).optional(),
  note: z.string().max(4000).optional(),
  vip: z.boolean().optional(),
});
