import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  marketFlag,
  currencyForDomain,
  formatPrice,
  toNullableNumber,
  parseAsinFromInput,
  sortedMarkets,
  bestNewPrice,
  isSnoozed,
} from './formatters.js';
import type { TrackingItem, MarketRow } from '../state/types.js';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escapeHtml("it's & that's > this <")).toBe("it&#39;s &amp; that&#39;s &gt; this &lt;");
  });

  it('handles null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('handles numbers', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('marketFlag', () => {
  it('returns correct flags for known domains', () => {
    expect(marketFlag('de')).toBe('🇩🇪');
    expect(marketFlag('it')).toBe('🇮🇹');
    expect(marketFlag('fr')).toBe('🇫🇷');
    expect(marketFlag('es')).toBe('🇪🇸');
    expect(marketFlag('uk')).toBe('🇬🇧');
    expect(marketFlag('nl')).toBe('🇳🇱');
    expect(marketFlag('pl')).toBe('🇵🇱');
  });

  it('returns bullet for unknown domains', () => {
    expect(marketFlag('us')).toBe('•');
    expect(marketFlag('')).toBe('•');
    expect(marketFlag(null)).toBe('•');
  });
});

describe('currencyForDomain', () => {
  it('returns GBP for UK', () => {
    expect(currencyForDomain('uk')).toBe('£');
    expect(currencyForDomain('UK')).toBe('£');
  });

  it('returns EUR for other domains', () => {
    expect(currencyForDomain('de')).toBe('€');
    expect(currencyForDomain('it')).toBe('€');
    expect(currencyForDomain('fr')).toBe('€');
    expect(currencyForDomain('')).toBe('€');
    expect(currencyForDomain(null)).toBe('€');
  });
});

describe('formatPrice', () => {
  it('formats valid prices with currency', () => {
    expect(formatPrice(19.99, 'de')).toBe('€19.99');
    expect(formatPrice(19.99, 'uk')).toBe('£19.99');
  });

  it('returns dash for invalid prices', () => {
    expect(formatPrice(0)).toBe('—');
    expect(formatPrice(-1)).toBe('—');
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice('not a number')).toBe('—');
  });
});

describe('toNullableNumber', () => {
  it('converts valid numbers', () => {
    expect(toNullableNumber('10')).toBe(10);
    expect(toNullableNumber(10)).toBe(10);
    expect(toNullableNumber('10.5')).toBe(10.5);
    expect(toNullableNumber('10,5')).toBe(10.5);
  });

  it('returns null for invalid values', () => {
    expect(toNullableNumber('')).toBe(null);
    expect(toNullableNumber('abc')).toBe(null);
    expect(toNullableNumber(null)).toBe(null);
    expect(toNullableNumber(undefined)).toBe(null);
  });

  it('returns null for negative numbers', () => {
    expect(toNullableNumber('-5')).toBe(null);
  });
});

describe('parseAsinFromInput', () => {
  it('extracts ASIN from plain text', () => {
    expect(parseAsinFromInput('B0DCKJG2Z3')).toEqual(['B0DCKJG2Z3']);
  });

  it('extracts ASIN from Amazon URL', () => {
    expect(parseAsinFromInput('https://amazon.de/dp/B0DCKJG2Z3')).toEqual(['B0DCKJG2Z3']);
    expect(parseAsinFromInput('https://www.amazon.co.uk/gp/product/B08N5WRWNW')).toEqual(['B08N5WRWNW']);
  });

  it('handles multiple ASINs', () => {
    const input = 'B0DCKJG2Z3\nB08N5WRWNW';
    expect(parseAsinFromInput(input)).toEqual(['B0DCKJG2Z3', 'B08N5WRWNW']);
  });

  it('deduplicates ASINs', () => {
    expect(parseAsinFromInput('B0DCKJG2Z3 B0DCKJG2Z3')).toEqual(['B0DCKJG2Z3']);
  });

  it('returns empty array for invalid input', () => {
    expect(parseAsinFromInput('')).toEqual([]);
    expect(parseAsinFromInput('not-an-asin')).toEqual([]);
  });
});

describe('sortedMarkets', () => {
  it('sorts markets by MARKET_ORDER', () => {
    const rows: MarketRow[] = [
      { market: 'fr', newPrice: 10, usedPrice: null, trendPct: null },
      { market: 'de', newPrice: 12, usedPrice: null, trendPct: null },
      { market: 'uk', newPrice: 15, usedPrice: null, trendPct: null },
    ];
    const sorted = sortedMarkets(rows);
    expect(sorted.map((r) => r.market)).toEqual(['de', 'fr', 'uk']);
  });
});

describe('bestNewPrice', () => {
  it('returns the lowest new price', () => {
    const item: TrackingItem = {
      asin: 'TEST',
      pricesNew: { de: 20, fr: 15, uk: 25 },
    };
    expect(bestNewPrice(item)).toBe(15);
  });

  it('returns null when no prices exist', () => {
    const item: TrackingItem = { asin: 'TEST' };
    expect(bestNewPrice(item)).toBe(null);
  });
});

describe('isSnoozed', () => {
  it('returns true when snooze is active', () => {
    const item: TrackingItem = {
      asin: 'TEST',
      snooze: { active: true, until: new Date(Date.now() + 60000).toISOString() },
    };
    expect(isSnoozed(item)).toBe(true);
  });

  it('returns true when snooze until is in the future', () => {
    const item: TrackingItem = {
      asin: 'TEST',
      snooze: { active: false, until: new Date(Date.now() + 60000).toISOString() },
    };
    expect(isSnoozed(item)).toBe(true);
  });

  it('returns false when snooze until is in the past', () => {
    const item: TrackingItem = {
      asin: 'TEST',
      snooze: { active: false, until: new Date(Date.now() - 60000).toISOString() },
    };
    expect(isSnoozed(item)).toBe(false);
  });

  it('returns false when no snooze exists', () => {
    const item: TrackingItem = { asin: 'TEST' };
    expect(isSnoozed(item)).toBe(false);
  });
});
