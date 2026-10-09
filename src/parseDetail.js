import { isBlockedResponse } from './parseSearch.js';
import { buildSearchUrl } from './searchRequest.js';

const XSSI_PREFIX = /^\)\]\}'\s*/;
const PLACE_PHOTO = /googleusercontent\.com\/(?:gps-cs|grass-cs|p\/)/;

/**
 * Detail lookup for one business. A name-plus-address query returns that place's card,
 * including website, hours, photo URLs, and a short review list.
 * @param {{ name?: string, address?: string }} place
 */
export function buildDetailUrl(place) {
    const query = [place?.name, place?.address].filter(Boolean).join(', ');
    return buildSearchUrl(query, 0, 5);
}

/**
 * Parse the detail JSON for one place.
 * Pass `maxReviews` 0 to leave reviews empty. Review snippets travel in this same
 * payload, so callers that do not want reviews should not store them.
 * @param {string | Buffer | Uint8Array} body
 * @param {{ placeId: string, maxReviews?: number }} options
 */
export function parseDetailResponse(body, { placeId, maxReviews = 0 } = {}) {
    const text = toText(body);
    if (isBlockedResponse(text)) {
        throw blockedError('Google Maps returned a block page instead of place JSON');
    }

    let data;
    try {
        data = JSON.parse(text.replace(XSSI_PREFIX, ''));
    } catch {
        throw blockedError('Google Maps place response was not JSON');
    }

    const items = data?.[0]?.[1];
    if (!Array.isArray(items)) {
        throw blockedError('Google Maps place response had no result list');
    }

    const card = items
        .map((item) => item?.[14])
        .find((candidate) => candidate?.[78] === placeId || candidate?.[10] === placeId);
    if (!card) return null;

    return {
        website: readWebsite(card),
        openingHours: readOpeningHours(card),
        reviews: readReviews(card, maxReviews),
        photoUrls: readPhotoUrls(card),
    };
}

/**
 * One flat dataset record. Missing detail fields stay null or empty.
 * When reviews were fetched, reviewCount matches reviews.length.
 * A failed detail fetch, or includeReviews: false, keeps the search-phase count.
 * @param {Record<string, unknown>} place
 * @param {Record<string, unknown> | null | undefined} detail
 * @param {{ includeReviews?: boolean }} [options]
 */
export function mergeListing(place, detail, { includeReviews = true } = {}) {
    const detailSucceeded = detail != null;
    const reviews = includeReviews ? (detail?.reviews ?? []) : [];
    const reviewCount = detailSucceeded && includeReviews
        ? reviews.length
        : (place.reviewCount ?? null);

    return {
        placeId: place.placeId,
        featureId: place.featureId,
        name: place.name,
        address: place.address,
        phone: place.phone,
        category: place.category,
        categories: place.categories,
        rating: place.rating,
        reviewCount,
        coordinates: place.coordinates,
        searchQuery: place.searchQuery,
        website: detail?.website ?? null,
        openingHours: detail?.openingHours ?? null,
        reviews,
        photoUrls: detail?.photoUrls ?? [],
    };
}

function readWebsite(card) {
    const url = card?.[7]?.[0];
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    if (/google\.[^/]+\/maps|gstatic\.com|googleusercontent\.com/i.test(url)) return null;
    return url;
}

function readOpeningHours(card) {
    const days = card?.[203]?.[0];
    if (!Array.isArray(days)) return null;

    const openingHours = {};
    for (const day of days) {
        if (!Array.isArray(day) || typeof day[0] !== 'string') continue;
        const ranges = Array.isArray(day[3])
            ? day[3].map((range) => cleanHours(range?.[0])).filter(Boolean)
            : [];
        if (ranges.length) openingHours[day[0]] = ranges;
    }
    return Object.keys(openingHours).length ? openingHours : null;
}

function readReviews(card, limit) {
    if (!limit) return [];
    const list = card?.[31]?.[1];
    if (!Array.isArray(list)) return [];

    const reviews = [];
    for (const review of list) {
        if (!Array.isArray(review) || typeof review[1] !== 'string') continue;
        const text = review[1].replace(/^"|"$/g, '').trim();
        if (!text) continue;
        reviews.push({
            text,
            rating: typeof review[9] === 'number' ? review[9] : null,
            authorUrl: typeof review[0]?.[0] === 'string' ? review[0][0] : null,
        });
        if (reviews.length >= limit) break;
    }
    return reviews;
}

function readPhotoUrls(card) {
    const urls = [];
    const seen = new Set();
    walk(card?.[72], (value) => {
        if (!PLACE_PHOTO.test(value) || value.includes('default-user')) return;
        const url = canonicalPhotoUrl(value.startsWith('//') ? `https:${value}` : value);
        if (seen.has(url)) return;
        seen.add(url);
        urls.push(url);
    });
    return urls;
}

function canonicalPhotoUrl(url) {
    return url.replace(/=w\d+-h\d+-k-no.*$/, '');
}

function cleanHours(value) {
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/[\u202f\u00a0]/g, ' ').replace(/[\u2013\u2014]/g, '-').trim();
    return cleaned || null;
}

function walk(node, visit) {
    if (typeof node === 'string') {
        visit(node);
        return;
    }
    if (Array.isArray(node)) node.forEach((child) => walk(child, visit));
}

function toText(body) {
    if (typeof body === 'string') return body;
    if (body == null) return '';
    return Buffer.from(body).toString('utf8');
}

function blockedError(message) {
    const error = new Error(message);
    error.isBlocked = true;
    return error;
}
