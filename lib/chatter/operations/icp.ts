export const CHATTER_ICP = {
  personTitles: [
    "owner",
    "founder",
    "ceo",
    "director general",
    "director de marketing",
    "gerente de marketing",
    "director comercial",
    "gerente comercial",
  ],
  personSeniorities: ["owner", "founder", "c_suite", "director", "head", "manager"],
  organizationIndustries: [
    "real estate",
    "hospital & health care",
    "legal services",
    "construction",
    "education management",
    "professional training & coaching",
    "hospitality",
  ],
  employeeRanges: ["5,10", "11,25", "26,50", "51,100", "101,200"],
} as const;

export function extractCity(objective: string) {
  const match = objective.match(/\ben\s+(.+)$/i);
  return match?.[1]?.trim() || "Mexico";
}
