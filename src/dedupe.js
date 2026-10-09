/**
 * Keep the first listing for each place ID. Later queries skip duplicates.
 * @param {Set<string>} seen
 * @param {Array<{ placeId?: string }>} places
 */
export function takeNewPlaces(seen, places) {
    const fresh = [];
    for (const place of places) {
        if (!place?.placeId || seen.has(place.placeId)) continue;
        seen.add(place.placeId);
        fresh.push(place);
    }
    return fresh;
}
