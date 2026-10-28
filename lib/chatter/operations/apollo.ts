import { requiredEnv } from "@/lib/supabase/server";

export type ApolloPerson = { id?: string; firstName?: string; lastName?: string; title?: string; organization?: { name?: string; primaryDomain?: string } };

export async function searchApolloPeople(query: string): Promise<ApolloPerson[]> {
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": requiredEnv("APOLLO_API_KEY") }, body: JSON.stringify({ q_keywords: query, person_titles: ["owner", "founder", "director", "gerente"], include_similar_titles: true, per_page: 10 }), cache: "no-store" });
  if (!response.ok) throw new Error("apollo_people_search_failed");
  const data = await response.json() as { people?: ApolloPerson[] };
  return data.people ?? [];
}
