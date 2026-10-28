import { requiredEnv } from "@/lib/supabase/server";

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
  const response = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("GOHIGHLEVEL_API_KEY")}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ locationId: requiredEnv("GOHIGHLEVEL_LOCATION_ID"), ...contact }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("gohighlevel_contact_failed");
  return response.json() as Promise<{ contact?: { id?: string } }>;
}
