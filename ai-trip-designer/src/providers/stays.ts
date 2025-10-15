import type {
  ProviderConfig,
  ProviderContext,
  StayOption,
  StaySearchParams,
  StaysResult
} from '../types';

const MOCK_STAYS: Omit<StayOption, 'pricePerNightUSD' | 'totalUSD'>[] = [
  {
    name: 'Old Town Guesthouse',
    type: 'budget',
    rating: 4.4,
    address: 'Soi Moonmuang 8, Chiang Mai',
    link: 'https://example.com/old-town-guesthouse'
  },
  {
    name: 'Nimman Boutique Hotel',
    type: 'mid',
    rating: 4.6,
    address: 'Nimmanahaeminda Rd., Chiang Mai',
    link: 'https://example.com/nimman-boutique'
  },
  {
    name: 'Ping River Retreat',
    type: 'premium',
    rating: 4.8,
    address: 'Charoenrat Rd., Chiang Mai',
    link: 'https://example.com/ping-river-retreat'
  },
  {
    name: 'Night Bazaar Lofts',
    type: 'mid',
    rating: 4.5,
    address: 'Chang Khlan Rd., Chiang Mai',
    link: 'https://example.com/night-bazaar-lofts'
  },
  {
    name: 'Doi Suthep View Villas',
    type: 'premium',
    rating: 4.9,
    address: 'Huay Kaew Rd., Chiang Mai',
    link: 'https://example.com/doi-suthep-view'
  },
  {
    name: 'Backpackers Hub Hostel',
    type: 'budget',
    rating: 4.2,
    address: 'Tha Phae Gate, Chiang Mai',
    link: 'https://example.com/backpackers-hub'
  },
  {
    name: 'Riverside Boutique Suites',
    type: 'premium',
    rating: 4.7,
    address: 'Wat Ket, Chiang Mai',
    link: 'https://example.com/riverside-boutique'
  },
  {
    name: 'Garden Lane Homestay',
    type: 'budget',
    rating: 4.3,
    address: 'Santitham, Chiang Mai',
    link: 'https://example.com/garden-lane-homestay'
  },
  {
    name: 'Craft Hotel Nimman',
    type: 'mid',
    rating: 4.6,
    address: 'Nimmanahaeminda Soi 11, Chiang Mai',
    link: 'https://example.com/craft-hotel-nimman'
  },
  {
    name: 'Zen Garden Residence',
    type: 'premium',
    rating: 4.9,
    address: 'Mae Rim, Chiang Mai',
    link: 'https://example.com/zen-garden-residence'
  }
];

function withPricing(
  stays: typeof MOCK_STAYS,
  params: StaySearchParams
): StayOption[] {
  const basePrices: Record<StayOption['type'], number> = {
    budget: 35,
    mid: 82,
    premium: 185
  };

  return stays.map((stay, index) => {
    const priceAdjust = 1 + index * 0.05;
    const nightly = Math.round(basePrices[stay.type] * priceAdjust);
    const total = nightly * params.nights;

    return {
      ...stay,
      pricePerNightUSD: nightly,
      totalUSD: total
    };
  });
}

export async function searchStaysProvider(
  params: StaySearchParams,
  context: ProviderContext,
  config: ProviderConfig
): Promise<StaysResult> {
  const cacheKey = `stays:${JSON.stringify(params)}`;
  const cached = context.cache.get<StaysResult>(cacheKey);
  if (cached) {
    context.providersUsed.add('cache:stays');
    return cached;
  }

  // Placeholder for future Booking.com or Amadeus integration
  if (config.booking?.rapidApiKey) {
    console.info(
      '[providers/stays] Booking.com integration not yet implemented; falling back to mock data.'
    );
  }

  context.providersUsed.add('stays:mock');
  const result: StaysResult = {
    note:
      'Using curated Chiang Mai stays. Provide a Booking/Amadeus key to enable live inventory.',
    options: withPricing(MOCK_STAYS, params)
  };
  context.cache.set(cacheKey, result);
  return result;
}
