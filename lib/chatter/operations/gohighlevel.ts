import { connectorCredentials } from "../connectors/server";
import { ApiError } from "@/lib/supabase/server";

export type GoHighLevelContact = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  website?: string;
  source?: string;
};

export async function createGoHighLevelContact(contact: GoHighLevelContact) {
  const credentials = await connectorCredentials("gohighlevel");
  const response = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.GOHIGHLEVEL_API_KEY}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ locationId: credentials.GOHIGHLEVEL_LOCATION_ID, ...contact }),
    signal: AbortSignal.timeout(20000), cache: "no-store",
  });
  if (!response.ok) throw new ApiError(502, "gohighlevel_contact_failed", `El CRM rechazó el contacto (HTTP ${response.status}). Revisa permisos y Location ID.`);
  return response.json() as Promise<{ contact?: { id?: string } }>;
}
