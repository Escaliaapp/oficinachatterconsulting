import { requiredEnv } from "@/lib/supabase/server";

export type PlaceLead = { name: string; address?: string; phone?: string; website?: string; mapsUrl?: string; placeId?: string };

export async function searchGooglePlaces(query: string, pageSize = 20): Promise<PlaceLead[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": requiredEnv("GOOGLE_MAPS_API_KEY"), "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri" }, body: JSON.stringify({ textQuery: query, pageSize: Math.min(Math.max(pageSize, 1), 20), languageCode: "es" }), cache: "no-store" });
  if (!response.ok) throw new Error("google_places_search_failed");
  const data = await response.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; nationalPhoneNumber?: string; websiteUri?: string; googleMapsUri?: string }> };
  return (data.places ?? []).map(place => ({ name: place.displayName?.text ?? "Sin nombre", address: place.formattedAddress, phone: place.nationalPhoneNumber, website: place.websiteUri, mapsUrl: place.googleMapsUri, placeId: place.id }));
}
