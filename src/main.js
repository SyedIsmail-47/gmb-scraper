import { Actor } from 'apify';
import { log } from 'crawlee';

import { runSearch } from './crawler.js';
import { normalizeInput } from './input.js';

await Actor.main(async () => {
    const input = normalizeInput(await Actor.getInput());
    if (!input.searchQueries.length) {
        throw new Error('Input searchQueries must contain at least one search string.');
    }

    log.info(`Searching ${input.searchQueries.length} quer${input.searchQueries.length === 1 ? 'y' : 'ies'}, then loading place details`);
    await runSearch(input);
});
