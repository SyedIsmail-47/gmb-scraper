import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDetailUrl, mergeListing, parseDetailResponse } from '../src/parseDetail.js';

const PLACE_ID = 'ChIJEQf7mBWfToYRDY2J55WnuJA';

function detailCard() {
    const card = [];
    card[7] = ['https://maafirm.com/austin-personal-injury-lawyer/', 'maafirm.com'];
    card[10] = '0x864e9f1598fb0711:0x90b8a795e7898d0d';
    card[31] = [null, [
        [
            ['https://www.google.com/maps/contrib/1042'],
            '"Their staff displays great service and are very thorough."',
            null,
            null,
            null,
            2,
            null,
            null,
            '1042',
            5,
        ],
        [
            ['https://www.google.com/maps/contrib/2099'],
            '"I will be coming back."',
            null,
            null,
            null,
            2,
            null,
            null,
            '2099',
            4,
        ],
    ]];
    card[72] = [[null, null, null, null, null, null, 'https://lh3.googleusercontent.com/gps-cs-s/photo-one']];
    card[78] = PLACE_ID;
    card[203] = [[
        ['Monday', 1, [2026, 9, 28], [['9\u202fAM\u20135\u202fPM', [[9], [17]]]]],
        ['Tuesday', 2, [2026, 9, 29], [['Closed', [[], []]]]],
    ]];
    return card;
}

function detailBody(card) {
    const item = [];
    item[14] = card;
    const payload = [];
    payload[0] = ['query', [null, item]];
    return `)]}'\n${JSON.stringify(payload)}`;
}

const place = {
    placeId: PLACE_ID,
    featureId: '0x864e9f1598fb0711:0x90b8a795e7898d0d',
    name: 'Anderson Injury Lawyers Austin',
    address: '811 Nueces St, Austin, TX 78701',
    phone: '+15127102766',
    category: 'Law firm',
    categories: ['Law firm'],
    rating: 5,
    reviewCount: 208,
    coordinates: { latitude: 30.2722202, longitude: -97.7472538 },
    searchQuery: 'law firm in Austin, TX',
};

test('parseDetailResponse reads website, hours, capped reviews, and photo URLs', () => {
    const detail = parseDetailResponse(detailBody(detailCard()), { placeId: PLACE_ID, maxReviews: 1 });
    assert.equal(detail.website, 'https://maafirm.com/austin-personal-injury-lawyer/');
    assert.deepEqual(detail.openingHours, {
        Monday: ['9 AM-5 PM'],
        Tuesday: ['Closed'],
    });
    assert.deepEqual(detail.reviews, [{
        text: 'Their staff displays great service and are very thorough.',
        rating: 5,
        authorUrl: 'https://www.google.com/maps/contrib/1042',
    }]);
    assert.deepEqual(detail.photoUrls, ['https://lh3.googleusercontent.com/gps-cs-s/photo-one']);
});

test('maxReviews 0 leaves reviews empty', () => {
    const detail = parseDetailResponse(detailBody(detailCard()), { placeId: PLACE_ID, maxReviews: 0 });
    assert.deepEqual(detail.reviews, []);
    assert.equal(detail.website, 'https://maafirm.com/austin-personal-injury-lawyer/');
});

test('a missing place returns null instead of throwing', () => {
    assert.equal(parseDetailResponse(detailBody(detailCard()), { placeId: 'ChIJmissing', maxReviews: 8 }), null);
});

test('a block page is flagged so only that request can be retried', () => {
    assert.throws(
        () => parseDetailResponse('<html>unusual traffic</html>', { placeId: PLACE_ID, maxReviews: 8 }),
        (error) => error.isBlocked === true,
    );
});

test('mergeListing keeps search and detail fields on one object', () => {
    const detail = parseDetailResponse(detailBody(detailCard()), { placeId: PLACE_ID, maxReviews: 8 });
    const listing = mergeListing(place, detail);
    assert.equal(listing.name, place.name);
    assert.equal(listing.website, detail.website);
    assert.equal(listing.searchQuery, place.searchQuery);
    assert.equal(listing.detail, undefined);
    assert.equal(listing.reviewCount, detail.reviews.length);
    assert.equal(mergeListing(place, null).website, null);
    assert.equal(mergeListing(place, null).reviewCount, 208);
    assert.deepEqual(mergeListing(place, null).reviews, []);
    assert.deepEqual(mergeListing(place, null).photoUrls, []);
});

test('skipping reviews keeps the search-phase reviewCount', () => {
    const detail = parseDetailResponse(detailBody(detailCard()), { placeId: PLACE_ID, maxReviews: 0 });
    const listing = mergeListing(place, detail, { includeReviews: false });
    assert.equal(listing.reviewCount, 208);
    assert.deepEqual(listing.reviews, []);
    assert.equal(listing.website, detail.website);
});

test('buildDetailUrl looks the place up by name and address', () => {
    const url = new URL(buildDetailUrl(place));
    assert.equal(url.searchParams.get('tbm'), 'map');
    assert.match(url.searchParams.get('q'), /Anderson Injury Lawyers Austin, 811 Nueces St/);
});
