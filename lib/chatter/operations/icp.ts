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
  organizationKeywordTags: ["desarollos inmobiliarios", "desarrollos", "casas"],
  organizationKeywordFields: ["tags", "social_media_description"],
  employeeRanges: ["1,10", "11,20", "21,50", "51,100", "101,200"],
} as const;

export function extractCity(objective: string) {
  const match = objective.match(/\ben\s+(.+)$/i);
  return match?.[1]?.trim() || "Mexico";
}
