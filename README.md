# Google Maps Business Scraper

A product of **Rodexco** — fast, cost-efficient local business data extraction from Google Maps.

## What it does

Search Google Maps by keyword and location, and get back structured business
data: name, address, phone, category, rating, website, opening hours,
reviews, and photo links — without the overhead of a browser-based scraper.

## Why it's different

Most Google Maps scrapers run a full headless browser per request, which
drives up cost and slow-downs. This Actor reads Google Maps' own data
response directly, which means faster runs and lower cost per result
without sacrificing data completeness.

## Input

| Field | Description | Default |
|---|---|---|
| `searchQueries` | List of search terms, e.g. `"coffee shop in Austin, TX"` | coffee shop in Austin, TX |
| `maxResultsPerQuery` | Max businesses to return per query | 20 |
| `includeReviews` | Whether to fetch reviews for each business | true |
| `maxReviewsPerPlace` | Max reviews to include per business | 8 |

## Output

One dataset record per business, including:

```json
{
  "placeId": "...",
  "name": "...",
  "address": "...",
  "phone": "...",
  "category": "...",
  "rating": 4.5,
  "reviewCount": 12,
  "website": "...",
  "openingHours": { "Monday": "9 AM-5 PM", "...": "..." },
  "reviews": [{ "text": "...", "rating": 5, "authorUrl": "..." }],
  "photoUrls": ["..."]
}
```

## Notes

- In sparse or rural areas, Google itself may widen the search and return
  loosely related businesses or nearby towns — this reflects Google's own
  search behavior, not a scraping error.
- Reviews are capped per run for speed and cost efficiency; this is not a
  full review-history export.
- Photos are returned as URLs only — images are not downloaded or stored.

## Support

Built and maintained by Rodexco. For issues or feature requests, reach out
via the Actor's Issues tab on Apify Store.
