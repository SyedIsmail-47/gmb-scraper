export const PAGE_SIZE = 20;

/**
 * Google Maps search JSON endpoint. `!7i` is the page size and `!8i` is the offset.
 * @param {string} query
 * @param {number} [offset]
 * @param {number} [pageSize]
 */
export function buildSearchUrl(query, offset = 0, pageSize = PAGE_SIZE) {
    const pb = [
        `!1s${encodeURIComponent(query)}`,
        `!7i${pageSize}`,
        `!8i${offset}`,
        '!10b1!12m6!1m1!18b1!2m1!20e3!6m1!114b1!17m1!3e1!20m57!2m2!1i203!2i100',
        '!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2!1i408!2i240',
        '!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3',
        '!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2',
        '!2b1!9b0!15m8!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20',
    ].join('');

    const params = new URLSearchParams({
        tbm: 'map',
        hl: 'en',
        gl: 'us',
        q: query,
    });
    return `https://www.google.com/search?${params.toString()}&pb=${pb}`;
}
