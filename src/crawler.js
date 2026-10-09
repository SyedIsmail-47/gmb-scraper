import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

import { takeNewPlaces } from './dedupe.js';
import { buildDetailUrl, mergeListing, parseDetailResponse } from './parseDetail.js';
import { parseSearchResponse } from './parseSearch.js';
import { nextProxyTier, proxyUrlForTier, startingProxy } from './proxy.js';
import { buildSearchUrl, PAGE_SIZE } from './searchRequest.js';

/**
 * Search each query, then fetch one detail payload per new place, and push a flat record.
 * @param {ReturnType<import('./input.js').normalizeInput>} input
 */
export async function runSearch(input) {
    const seen = new Set();
    const savedByQuery = new Map();
    const pushed = new Set();
    const stats = {
        detailSucceeded: 0,
        detailFailed: 0,
        detailBlocked: 0,
        residentialRetries: 0,
    };
    const { tier: initialTier, proxyInput } = startingProxy(input.proxyConfiguration);
    const proxyConfiguration = proxyInput
        ? await Actor.createProxyConfiguration(proxyInput)
        : undefined;

    const pushListing = async (place, detail) => {
        if (!place?.placeId || pushed.has(place.placeId)) return;
        pushed.add(place.placeId);
        const chargeResult = await Actor.pushData(
            mergeListing(place, detail, { includeReviews: input.includeReviews }),
            'business-scraped',
        );
        if (chargeResult?.eventChargeLimitReached) {
            log.warning('Spending limit reached. Stopping before more businesses are scraped.');
            await Actor.exit('Spending limit reached');
        }
    };

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        sameDomainDelaySecs: input.requestDelaySecs,
        maxConcurrency: 1,
        maxRequestRetries: 2,
        additionalMimeTypes: ['application/json', 'text/plain'],
        preNavigationHooks: [
            ({ request }, gotOptions) => {
                if (request.userData.proxyUrl) gotOptions.proxyUrl = request.userData.proxyUrl;
            },
        ],
        async requestHandler({ request, body, crawler: activeCrawler }) {
            if (request.userData.kind === 'detail') {
                await handleDetail(activeCrawler, request, body, pushListing, stats);
                return;
            }
            await handleSearch(activeCrawler, request, body, input, seen, savedByQuery, initialTier, stats);
        },
        failedRequestHandler({ request }) {
            if (request.userData.kind === 'detail') {
                stats.detailFailed += 1;
                log.error(`Detail request failed for ${request.userData.place?.name}; saving the search fields`);
                return pushListing(request.userData.place, null);
            }
            const { query, offset } = request.userData;
            log.error(`Search request failed for "${query}" at offset ${offset}; continuing with the rest of the run`);
        },
    });

    await crawler.run(input.searchQueries.map((query) => searchRequest(query, 0, initialTier)));
    logRunSummary(input, savedByQuery, pushed.size, stats);
}

function logRunSummary(input, savedByQuery, datasetRecords, stats) {
    const placesFound = [...savedByQuery.values()].reduce((sum, count) => sum + count, 0);
    log.info([
        `Summary: ${placesFound} places found,`,
        `${stats.detailSucceeded} detail fetches succeeded,`,
        `${stats.detailFailed} failed,`,
        `${stats.detailBlocked} blocked,`,
        `${stats.residentialRetries} retried through residential proxy.`,
        `${datasetRecords} dataset records.`,
    ].join(' '));
    for (const [query, count] of savedByQuery) {
        const capNote = count >= input.maxResultsPerQuery ? 'hit cap' : 'under cap';
        log.info(`Query "${query}": ${count} places (${capNote}, max ${input.maxResultsPerQuery})`);
    }
}

async function handleSearch(crawler, request, body, input, seen, savedByQuery, initialTier, stats) {
    const { query, offset, proxyTier = initialTier } = request.userData;
    let places;
    try {
        places = parseSearchResponse(body);
    } catch (error) {
        if (error.isBlocked) {
            await escalateSearch(crawler, request, query, offset, proxyTier, stats);
            return;
        }
        log.exception(error, `Skipping search page for "${query}" at offset ${offset}`);
        return;
    }

    const saved = savedByQuery.get(query) ?? 0;
    const room = Math.max(0, input.maxResultsPerQuery - saved);
    const fresh = takeNewPlaces(seen, places).slice(0, room).map((place) => ({ ...place, searchQuery: query }));
    savedByQuery.set(query, saved + fresh.length);
    log.info(`Found ${fresh.length} new businesses for "${query}" (offset ${offset})`);

    if (fresh.length) {
        await crawler.addRequests(fresh.map((place) => detailRequest(place, initialTier, input)));
    }

    const collected = savedByQuery.get(query) ?? 0;
    if (places.length >= PAGE_SIZE && collected < input.maxResultsPerQuery) {
        const nextOffset = offset + PAGE_SIZE;
        await crawler.addRequests([searchRequest(query, nextOffset, proxyTier, request.userData.proxyUrl)]);
    }
}

let simulatedDetailBlockArmed = process.env.GMB_DEBUG_SIMULATE_DETAIL_BLOCK === '1';

/**
 * One-shot test hook. Armed only by the process environment, never by Actor input.
 * The residential retry is not simulated, so that request uses the real response.
 * @param {{ userData?: { kind?: string, proxyTier?: string } }} request
 */
function takeSimulatedDetailBlock(request) {
    if (!simulatedDetailBlockArmed) return false;
    if (request.userData?.kind !== 'detail') return false;
    if (request.userData.proxyTier === 'residential') return false;
    simulatedDetailBlockArmed = false;
    return true;
}

async function handleDetail(crawler, request, body, pushListing, stats) {
    const { place, maxReviews, proxyTier } = request.userData;
    try {
        if (takeSimulatedDetailBlock(request)) {
            log.warning(`Simulated malformed detail response for ${place.name}`);
            const error = new Error('Simulated malformed detail response');
            error.isBlocked = true;
            throw error;
        }
        const detail = parseDetailResponse(body, { placeId: place.placeId, maxReviews });
        if (!detail) {
            stats.detailFailed += 1;
            log.warning(`No detail payload for ${place.name}; saving the search fields`);
        } else {
            stats.detailSucceeded += 1;
        }
        await pushListing(place, detail);
    } catch (error) {
        if (error.isBlocked) {
            stats.detailBlocked += 1;
            await escalateDetail(crawler, request, place, proxyTier, pushListing, stats);
            return;
        }
        stats.detailFailed += 1;
        log.exception(error, `Detail parse failed for ${place.name}; saving the search fields`);
        await pushListing(place, null);
    }
}

function searchRequest(query, offset, proxyTier, proxyUrl) {
    return {
        url: buildSearchUrl(query, offset),
        uniqueKey: `search:${query}:${offset}:${proxyTier}`,
        userData: {
            kind: 'search',
            query,
            offset,
            proxyTier,
            ...(proxyUrl ? { proxyUrl } : {}),
        },
    };
}

function detailRequest(place, proxyTier, input, proxyUrl) {
    return {
        url: buildDetailUrl(place),
        uniqueKey: `detail:${place.placeId}:${proxyTier}`,
        userData: {
            kind: 'detail',
            place,
            proxyTier,
            maxReviews: input.includeReviews ? input.maxReviewsPerPlace : 0,
            ...(proxyUrl ? { proxyUrl } : {}),
        },
    };
}

async function escalateSearch(crawler, request, query, offset, proxyTier, stats) {
    const tier = nextProxyTier(proxyTier);
    if (!tier) {
        log.warning(`Still blocked for "${query}" at offset ${offset} on a residential proxy; skipping this page`);
        return;
    }

    log.warning(`Blocked search response for "${query}" at offset ${offset}. Retrying once via ${tier} proxy.`);
    try {
        const proxyUrl = await proxyUrlForTier(tier);
        if (!proxyUrl) {
            log.warning(`No ${tier} proxy URL is available. Skipping "${query}" at offset ${offset}.`);
            return;
        }
        if (tier === 'residential') stats.residentialRetries += 1;
        await crawler.addRequests([searchRequest(query, offset, tier, proxyUrl)]);
    } catch (error) {
        log.warning(`Could not open a ${tier} proxy for "${query}": ${error.message}`);
    }
}

async function escalateDetail(crawler, request, place, proxyTier, pushListing, stats) {
    if (proxyTier === 'residential') {
        stats.detailFailed += 1;
        log.warning(`Detail request for ${place.name} is still blocked on a residential proxy; saving the search fields`);
        await pushListing(place, null);
        return;
    }

    log.warning(`Blocked detail response for ${place.name}. Retrying that request via the residential proxy.`);
    try {
        const proxyUrl = await proxyUrlForTier('residential');
        if (!proxyUrl) {
            stats.detailFailed += 1;
            log.warning(`No residential proxy URL is available for ${place.name}; saving the search fields`);
            await pushListing(place, null);
            return;
        }
        stats.residentialRetries += 1;
        await crawler.addRequests([detailRequest(place, 'residential', {
            includeReviews: request.userData.maxReviews > 0,
            maxReviewsPerPlace: request.userData.maxReviews,
        }, proxyUrl)]);
    } catch (error) {
        stats.detailFailed += 1;
        log.warning(`Could not open a residential proxy for ${place.name}: ${error.message}`);
        await pushListing(place, null);
    }
}
