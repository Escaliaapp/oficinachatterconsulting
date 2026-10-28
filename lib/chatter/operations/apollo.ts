import { requiredEnv } from "@/lib/supabase/server";
import { CHATTER_ICP, extractCity } from "@/lib/chatter/operations/icp";

export type ApolloPerson = { id?: string; firstName?: string; lastName?: string; title?: string; linkedinUrl?: string; linkedin_url?: string; organization?: { name?: string; primaryDomain?: string } };

export async function searchApolloPeople(query: string): Promise<ApolloPerson[]> {
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": requiredEnv("APOLLO_API_KEY") },
    body: JSON.stringify({
      q_keywords: query,
      person_titles: CHATTER_ICP.personTitles,
      person_seniorities: CHATTER_ICP.personSeniorities,
      person_not_titles: ["intern", "assistant", "student"],
      person_locations: ["Mexico"],
      organization_locations: [extractCity(query)],
      organization_industries: CHATTER_ICP.organizationIndustries,
      organization_num_employees_ranges: CHATTER_ICP.employeeRanges,
      include_similar_titles: true,
      per_page: 10,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("apollo_people_search_failed");
  const data = await response.json() as { people?: ApolloPerson[] };
  return data.people ?? [];
}

export async function getApolloPerson(id: string) {
  const response = await fetch(`https://api.apollo.io/api/v1/people/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json", "x-api-key": requiredEnv("APOLLO_API_KEY") },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("apollo_person_info_failed");
  return response.json();
}
