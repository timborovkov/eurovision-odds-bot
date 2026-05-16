import { describe, expect, it } from 'vitest';

import { humanizeSlug } from '@/app/components/MarketFilter';

describe('humanizeSlug', () => {
  // Covers all 13 currently configured slugs so the filter chips stay short
  // regardless of whether Polymarket put "2026" at the start, middle, or end.
  it.each([
    ['eurovision-winner-2026', 'Winner'],
    ['eurovision-2026-top-3', 'Top 3'],
    ['eurovision-2026-top-5', 'Top 5'],
    ['eurovision-2026-top-10', 'Top 10'],
    ['eurovision-2026-jury-winner', 'Jury Winner'],
    ['eurovision-2026-televote-winner', 'Televote Winner'],
    ['eurovision-2nd-place-2026', '2nd Place'],
    ['eurovision-3rd-place-2026', '3rd Place'],
    ['eurovision-last-place-2026', 'Last Place'],
    ['eurovision-2026-best-nordic-country', 'Best Nordic Country'],
    ['eurovision-2026-margin-of-victory', 'Margin Of Victory'],
    ['eurovision-2026-first-semi-final-winner', 'First Semi Final Winner'],
    ['eurovision-2026-second-semi-final-winner', 'Second Semi Final Winner'],
  ])('strips eurovision/2026 noise and title-cases %s → %s', (input, expected) => {
    expect(humanizeSlug(input)).toBe(expected);
  });

  it('falls back to the raw slug when every token is noise', () => {
    expect(humanizeSlug('eurovision-2026')).toBe('eurovision-2026');
    expect(humanizeSlug('eurovision')).toBe('eurovision');
  });

  it('handles non-Eurovision slugs without mangling them', () => {
    expect(humanizeSlug('us-election-2024')).toBe('Us Election 2024');
  });
});
