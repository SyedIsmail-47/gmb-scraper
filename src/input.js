/**
 * Apply the same defaults as `.actor/input_schema.json` for local runs.
 * @param {Record<string, unknown> | null | undefined} raw
 */
export function normalizeInput(raw = {}) {
    const input = raw ?? {};
    const searchQueries = Array.isArray(input.searchQueries)
        ? input.searchQueries.map((query) => String(query).trim()).filter(Boolean)
        : [];

    return {
        searchQueries,
        maxResultsPerQuery: numberOr(input.maxResultsPerQuery, 20),
        includeReviews: input.includeReviews !== false,
        maxReviewsPerPlace: numberOr(input.maxReviewsPerPlace, 8),
        requestDelaySecs: numberOr(input.requestDelaySecs, 1.5),
        proxyConfiguration: input.proxyConfiguration ?? { useApifyProxy: false },
    };
}

function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
