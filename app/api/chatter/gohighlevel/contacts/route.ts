import { z } from "zod";
import { apiError, json, parseBody } from "@/lib/supabase/server";
import { requireOfficeUser } from "@/lib/supabase/server";
import { createGoHighLevelContact } from "@/lib/chatter/operations/gohighlevel";

const contactSchema = z.object({
  name: z.string().trim().max(120).optional(), firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(),
  email: z.string().email().optional(), phone: z.string().trim().max(40).optional(), companyName: z.string().trim().max(160).optional(),
  website: z.string().url().optional(), source: z.string().trim().max(80).default("Diego · Chatter Consulting"),
}).refine((value) => value.email || value.phone, "El prospecto necesita correo o teléfono.");

export async function POST(request: Request) {
  try { await requireOfficeUser(request); const contact = await parseBody(request, contactSchema); const result = await createGoHighLevelContact(contact); return json({ ok: true, contactId: result.contact?.id ?? null }, 201); }
  catch (error) { return apiError(error); }
}
