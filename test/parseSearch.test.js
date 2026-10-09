import assert from 'node:assert/strict';
import test from 'node:test';

import { takeNewPlaces } from '../src/dedupe.js';
import { normalizeInput } from '../src/input.js';
import { isBlockedResponse, parseSearchResponse } from '../src/parseSearch.js';
import { nextProxyTier, startingProxy } from '../src/proxy.js';
import { buildSearchUrl, PAGE_SIZE } from '../src/searchRequest.js';

function placeCard() {
    const card = [];
    card[2] = ['811 Nueces St', 'Austin, TX 78701'];
    card[4] = [null, null, null, [null, '3,002 reviews'], null, null, null, 4.9];
    card[9] = [null, null, 30.2722202, -97.7472538];
    card[10] = '0x864e9f1598fb0711:0x90b8a795e7898d0d';
    card[11] = 'Anderson Injury Lawyers Austin';
    card[13] = ['Law firm', 'Personal injury attorney'];
    card[78] = 'ChIJEQf7mBWfToYRDY2J55WnuJA';
    card[178] = [['(512) 710-2766', null, null, '+15127102766']];
    return card;
}

function searchBody(cards) {
    const items = [null, ...cards.map((card) => {
        const item = [];
        item[14] = card;
        return item;
    })];
    const payload = [];
    payload[0] = ['law firm in Austin, TX', items];
    return `)]}'\n${JSON.stringify(payload)}`;
}

test('parseSearchResponse reads listing fields from the embedded JSON', () => {
    const [place] = parseSearchResponse(searchBody([placeCard()]));
    assert.equal(place.placeId, 'ChIJEQf7mBWfToYRDY2J55WnuJA');
    assert.equal(place.name, 'Anderson Injury Lawyers Austin');
    assert.equal(place.address, '811 Nueces St, Austin, TX 78701');
    assert.equal(place.phone, '+15127102766');
    assert.equal(place.category, 'Law firm');
    assert.equal(place.rating, 4.9);
    assert.equal(place.reviewCount, 3002);
    assert.deepEqual(place.coordinates, { latitude: 30.2722202, longitude: -97.7472538 });
});

test('parseSearchResponse returns an empty list for a short last page', () => {
    assert.deepEqual(parseSearchResponse(searchBody([])), []);
});

test('parseSearchResponse treats an HTML block page as a block', () => {
    assert.equal(isBlockedResponse('<!doctype html><html><title>unusual traffic</title>'), true);
    assert.throws(() => parseSearchResponse('<html>captcha</html>'), (error) => error.isBlocked === true);
});

test('takeNewPlaces keeps the first listing for a place ID', () => {
    const seen = new Set();
    const first = { placeId: 'ChIJabc', name: 'First' };
    const duplicate = { placeId: 'ChIJabc', name: 'Duplicate' };
    const second = { placeId: 'ChIJdef', name: 'Second' };
    assert.deepEqual(takeNewPlaces(seen, [first, duplicate]), [first]);
    assert.deepEqual(takeNewPlaces(seen, [duplicate, second]), [second]);
});

test('buildSearchUrl pages with a 20-result offset', () => {
    const url = new URL(buildSearchUrl('law firm in Austin, TX', 20));
    assert.equal(url.searchParams.get('tbm'), 'map');
    assert.equal(url.searchParams.get('q'), 'law firm in Austin, TX');
    assert.match(url.searchParams.get('pb') ? decodeURIComponent(url.href) : url.href, new RegExp(`!7i${PAGE_SIZE}!8i20`));
});

test('input defaults match the schema and residential is not the starting proxy', () => {
    const input = normalizeInput({ searchQueries: ['  dentists in Austin  '] });
    assert.deepEqual(input.searchQueries, ['dentists in Austin']);
    assert.equal(input.maxResultsPerQuery, 20);
    assert.equal(input.includeReviews, true);
    assert.equal(input.maxReviewsPerPlace, 8);
    assert.equal(input.requestDelaySecs, 1.5);
    assert.equal(startingProxy(input.proxyConfiguration).tier, 'none');
    assert.equal(startingProxy({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }).tier, 'datacenter');
    assert.equal(nextProxyTier('none'), 'datacenter');
    assert.equal(nextProxyTier('datacenter'), 'residential');
    assert.equal(nextProxyTier('residential'), null);
});
