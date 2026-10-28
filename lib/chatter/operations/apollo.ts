import { connectorCredentials } from "../connectors/server";
import { ApiError } from "@/lib/supabase/server";
import { CHATTER_ICP, apolloSearchFilters } from "@/lib/chatter/operations/icp";

export type ApolloPerson = { id?: string; firstName?: string; lastName?: string; title?: string; linkedinUrl?: string; linkedin_url?: string; organization?: { name?: string; primaryDomain?: string } };

export async function searchApolloPeople(query: string): Promise<ApolloPerson[]> {
  const unique = new Map<string, ApolloPerson>();
  for (const keyword of CHATTER_ICP.organizationKeywordTags) {
    if (unique.size >= 10) break;
    for (const person of await searchKeyword(query, keyword, 10 - unique.size)) {
      if (person.id) unique.set(person.id, person);
    }
  }
  return [...unique.values()].slice(0, 10);
}
async function searchKeyword(query: string, keyword: string, limit: number): Promise<ApolloPerson[]> {
  const credentials = await connectorCredentials("apollo");
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": credentials.APOLLO_API_KEY },
    body: JSON.stringify(apolloSearchFilters(query, keyword, limit)),
    signal: AbortSignal.timeout(20000), cache: "no-store",
  });
  if (!response.ok) {
    const code = response.status === 401 ? "apollo_api_key_invalid" : response.status === 403 ? "apollo_access_denied" : response.status === 422 ? "apollo_filters_invalid" : response.status === 429 ? "apollo_rate_limited" : "apollo_people_search_failed";
    throw new ApiError(502, code, code === "apollo_filters_invalid" ? "Apollo rechazó alguno de los filtros ICP." : code === "apollo_api_key_invalid" ? "La API key de Apollo no es válida." : code === "apollo_access_denied" ? "La cuenta o API key de Apollo no tiene acceso a People Search." : code === "apollo_rate_limited" ? "Apollo limitó temporalmente las solicitudes." : "Apollo no pudo completar la búsqueda.");
  }
  const data = await response.json() as { people?: Array<{ id?: string; first_name?: string; last_name_obfuscated?: string; title?: string; organization?: { name?: string } }> };
  return (data.people ?? []).filter(person => person.id).map(person => ({ id: person.id, firstName: person.first_name, lastName: person.last_name_obfuscated, title: person.title, organization: person.organization }));
}

export async function getApolloPerson(id: string) {
  const credentials = await connectorCredentials("apollo");
  const response = await fetch(`https://api.apollo.io/api/v1/people/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json", "x-api-key": credentials.APOLLO_API_KEY },
    signal: AbortSignal.timeout(20000), cache: "no-store",
  });
  if (!response.ok) throw new Error("apollo_person_info_failed");
  return response.json();
}
