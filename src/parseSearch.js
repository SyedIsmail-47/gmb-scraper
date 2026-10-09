const XSSI_PREFIX = /^\)\]\}'\s*/;
const FEATURE_ID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
const PLACE_ID = /^ChIJ[\w-]{8,}$/;
const E164_PHONE = /^\+\d{8,15}$/;
const DISPLAY_PHONE = /^(?:\+?\d[\d\s().-]{7,}\d)$/;

/**
 * Parse a Google Maps `tbm=map` search response into business listings.
 * @param {string | Buffer | Uint8Array} body
 * @returns {Array<Record<string, unknown>>}
 */
export function parseSearchResponse(body) {
    const text = toText(body);
    if (isBlockedResponse(text)) {
        throw blockedError('Google Maps returned a block page instead of search JSON');
    }

    let data;
    try {
        data = JSON.parse(text.replace(XSSI_PREFIX, ''));
    } catch {
        throw blockedError('Google Maps search response was not JSON');
    }

    const items = data?.[0]?.[1];
    if (!Array.isArray(items)) {
        throw blockedError('Google Maps search response had no result list');
    }

    const places = [];
    for (const item of items) {
        const place = parsePlaceCard(item?.[14]);
        if (place) places.push(place);
    }
    return places;
}

/**
 * HTML or a payload without the search list means the request was blocked.
 * A parsed list with zero place cards is a normal empty page.
 * @param {string} text
 */
export function isBlockedResponse(text) {
    const head = text.slice(0, 2500).toLowerCase();
    if (head.includes('<!doctype') || head.includes('<html')) return true;
    return head.includes('unusual traffic') || head.includes('our systems have detected');
}

/**
 * @param {unknown} card
 */
export function parsePlaceCard(card) {
    if (!Array.isArray(card)) return null;

    const featureId = card[10];
    const name = typeof card[11] === 'string' ? card[11].trim() : '';
    if (!FEATURE_ID.test(String(featureId)) || !name) return null;

    const placeId = readPlaceId(card) ?? String(featureId);
    const coordinates = readCoordinates(card[9]);
    const categories = Array.isArray(card[13])
        ? card[13].filter((value) => typeof value === 'string' && value.trim())
        : [];

    return {
        placeId,
        featureId: String(featureId),
        name,
        address: readAddress(card[2]),
        phone: findPhone(card),
        category: categories[0] ?? null,
        categories,
        rating: typeof card[4]?.[7] === 'number' ? card[4][7] : null,
        reviewCount: parseReviewCount(card[4]?.[3]?.[1]),
        coordinates,
    };
}

function readPlaceId(card) {
    if (typeof card[78] === 'string' && PLACE_ID.test(card[78])) return card[78];
    let found = null;
    walk(card, (value) => {
        if (!found && PLACE_ID.test(value)) found = value;
    });
    return found;
}

function readAddress(value) {
    if (!Array.isArray(value)) return null;
    const lines = value.filter((line) => typeof line === 'string' && line.trim());
    return lines.length ? lines.join(', ') : null;
}

function readCoordinates(value) {
    if (!Array.isArray(value) || value.length < 4) {
        return { latitude: null, longitude: null };
    }
    const latitude = typeof value[2] === 'number' ? value[2] : null;
    const longitude = typeof value[3] === 'number' ? value[3] : null;
    if (latitude == null || longitude == null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        return { latitude: null, longitude: null };
    }
    return { latitude, longitude };
}

function parseReviewCount(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/([\d,]+)\s+reviews?/i);
    if (!match) return null;
    const count = Number(match[1].replaceAll(',', ''));
    return Number.isFinite(count) ? count : null;
}

function findPhone(card) {
    let e164 = null;
    let display = null;
    walk(card, (value) => {
        if (!e164 && E164_PHONE.test(value)) e164 = value;
        else if (!display && DISPLAY_PHONE.test(value) && value.replace(/\D/g, '').length >= 8) display = value;
    });
    return e164 ?? display;
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
