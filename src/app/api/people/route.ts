import { withUser } from "@/server/auth/session";
import { parseBody } from "@/server/api/validate";
import { createContact, listContacts } from "@/server/contacts";
import { ContactBody } from "./schema";

/** The address book. */
export const GET = withUser(async (user) => Response.json(await listContacts(user.id)));

/** Someone added by hand. */
export const POST = withUser(async (user, req) => Response.json(await createContact(user.id, await parseBody(req, ContactBody)), { status: 201 }));
