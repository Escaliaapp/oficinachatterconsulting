export const CHATTER_ICP = {
  personTitles: [
    "director de mercadotecnia",
    "gerente de mercadotecnia",
    "director de operaciones",
    "gerente de operaciones",
    "gerente de ventas",
    "director de ventas",
    "director general",
    "gerente general",
  ],
  personSeniorities: ["director", "manager"],
  organizationIndustryTagIds: ["5567cd477369645401010000"],
  organizationKeywordTags: ["desarrollos inmobiliarios", "desarrollos", "casas"],
  organizationKeywordFields: ["tags", "social_media_description"],
  employeeRanges: ["1,10", "11,20", "21,50", "51,100", "101,200"],
} as const;

export function extractCity(objective: string) {
  const match = objective.match(/\ben\s+(.+)$/i);
  return match?.[1]?.trim() || "Mexico";
}

// The public people-search API documents q_keywords, not the web UI's tag fields.
// Run one supported keyword search at a time; do not send a whole task as keywords.
export function apolloSearchFilters(objective: string, keyword: string, limit = 10) {
  return {
    q_keywords: keyword,
    person_titles: CHATTER_ICP.personTitles,
    person_locations: ['Mexico'],
    organization_locations: [extractCity(objective)],
    organization_industry_tag_ids: CHATTER_ICP.organizationIndustryTagIds,
    organization_num_employees_ranges: CHATTER_ICP.employeeRanges,
    include_similar_titles: false,
    per_page: Math.min(10, Math.max(1, limit)),
  };
}
