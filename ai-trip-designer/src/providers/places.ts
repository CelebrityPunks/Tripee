import type {
  AttractionSearchParams,
  DestinationInfo,
  PlacesResult,
  ProviderConfig,
  ProviderContext
} from '../types';

interface GeonameResponse {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

interface OpenTripMapFeature {
  id: string;
  geometry: { type: string; coordinates: [number, number] };
  properties: {
    xid: string;
    name: string;
    kinds: string;
    rate?: number;
    osm?: string;
    wikidata?: string;
  };
}

const DEFAULT_KINDS =
  'interesting_places,tourist_facilities,culture,foods,restaurants,temples';

const MOCK_DESTINATION: DestinationInfo = {
  name: 'Chiang Mai',
  country: 'Thailand',
  lat: 18.7883,
  lon: 98.9853
};

const MOCK_PLACES = [
  {
    id: 'mock-wat-phra-singh',
    name: 'Wat Phra Singh',
    category: 'temple',
    lat: 18.788889,
    lon: 98.981944,
    url: 'https://goo.gl/maps/VWnvaQRcWtr',
    estMinutes: 90
  },
  {
    id: 'mock-wat-chedi-luang',
    name: 'Wat Chedi Luang',
    category: 'temple',
    lat: 18.786944,
    lon: 98.985556,
    url: 'https://goo.gl/maps/6L3pCTrGhm12',
    estMinutes: 75
  },
  {
    id: 'mock-sunday-market',
    name: 'Sunday Walking Street',
    category: 'market',
    lat: 18.7883,
    lon: 98.9853,
    url: 'https://goo.gl/maps/KTrgU5d5gNv',
    estMinutes: 120
  },
  {
    id: 'mock-elephant-nature-park',
    name: 'Elephant Nature Park',
    category: 'nature',
    lat: 18.9364,
    lon: 98.8576,
    url: 'https://goo.gl/maps/1pVxS6c3hHB2',
    estMinutes: 240
  },
  {
    id: 'mock-doi-suthep',
    name: 'Doi Suthep Temple',
    category: 'temple',
    lat: 18.8046,
    lon: 98.9215,
    url: 'https://goo.gl/maps/nc7ovjGpq8K2',
    estMinutes: 120
  },
  {
    id: 'mock-grand-canyon',
    name: 'Grand Canyon Water Park',
    category: 'adventure',
    lat: 18.6466,
    lon: 98.9807,
    url: 'https://goo.gl/maps/tT9nVWyN7Aq',
    estMinutes: 180
  },
  {
    id: 'mock-warorot-market',
    name: 'Warorot Market',
    category: 'market',
    lat: 18.791,
    lon: 99.001,
    url: 'https://goo.gl/maps/nsTfxcb5geT2',
    estMinutes: 90
  },
  {
    id: 'mock-nimman-coffee',
    name: 'Nimman Coffee Crawl',
    category: 'food',
    lat: 18.799,
    lon: 98.967,
    url: 'https://goo.gl/maps/owS1iEZzu1L2',
    estMinutes: 120
  },
  {
    id: 'mock-night-safari',
    name: 'Chiang Mai Night Safari',
    category: 'wildlife',
    lat: 18.7417,
    lon: 98.9236,
    url: 'https://goo.gl/maps/tiHXF6Uq7Kt',
    estMinutes: 150
  },
  {
    id: 'mock-cooking-class',
    name: 'Thai Farm Cooking School',
    category: 'food',
    lat: 18.8105,
    lon: 99.0288,
    url: 'https://goo.gl/maps/LpLwVB1USwq',
    estMinutes: 240
  },
  {
    id: 'mock-artisan-village',
    name: 'Bo Sang Umbrella Village',
    category: 'culture',
    lat: 18.7727,
    lon: 99.0857,
    url: 'https://goo.gl/maps/C2LKveJSu2R2',
    estMinutes: 120
  },
  {
    id: 'mock-night-market',
    name: 'Chiang Mai Night Bazaar',
    category: 'market',
    lat: 18.7837,
    lon: 99.0001,
    url: 'https://goo.gl/maps/hSu7dYNEsD52',
    estMinutes: 150
  }
];

function mapKindsToCategory(kinds: string): string {
  if (kinds.includes('temples')) return 'temple';
  if (kinds.includes('churches') || kinds.includes('religion')) return 'spiritual';
  if (kinds.includes('foods') || kinds.includes('restaurants')) return 'food';
  if (kinds.includes('natural')) return 'nature';
  if (kinds.includes('cultural')) return 'culture';
  if (kinds.includes('museums')) return 'museum';
  if (kinds.includes('sport')) return 'adventure';
  if (kinds.includes('amusements')) return 'entertainment';
  if (kinds.includes('shopping')) return 'shopping';
  return 'attraction';
}

function mapKindsToDuration(kinds: string): number {
  if (kinds.includes('foods') || kinds.includes('restaurants')) return 90;
  if (kinds.includes('temples') || kinds.includes('religion')) return 120;
  if (kinds.includes('museums')) return 120;
  if (kinds.includes('natural')) return 180;
  return 90;
}

export async function resolveDestination(
  city: string,
  context: ProviderContext,
  config: ProviderConfig
): Promise<DestinationInfo> {
  const cacheKey = `dest:${city.toLowerCase()}`;
  const cached = context.cache.get<DestinationInfo>(cacheKey);
  if (cached) {
    context.providersUsed.add('cache:opentripmap');
    return cached;
  }

  const apiKey = config.openTripMap?.apiKey;
  if (!apiKey) {
    context.providersUsed.add('opentripmap:mock');
    context.cache.set(cacheKey, MOCK_DESTINATION);
    return MOCK_DESTINATION;
  }

  try {
    const response = await fetch(
      `https://api.opentripmap.com/0.1/en/places/geoname?name=${encodeURIComponent(
        city
      )}&apikey=${apiKey}`
    );
    if (!response.ok) {
      console.warn(
        `[providers/places] Geoname lookup failed ${response.status}, falling back to mock.`
      );
      context.providersUsed.add('opentripmap:mock');
      context.cache.set(cacheKey, MOCK_DESTINATION);
      return MOCK_DESTINATION;
    }

    const data = (await response.json()) as GeonameResponse;
    const destination: DestinationInfo = {
      name: data.name,
      country: data.country,
      lat: data.lat,
      lon: data.lon
    };

    context.providersUsed.add('opentripmap');
    context.cache.set(cacheKey, destination);
    return destination;
  } catch (error) {
    console.error(
      '[providers/places] Geoname lookup error',
      (error as Error).message
    );
    context.providersUsed.add('opentripmap:mock');
    context.cache.set(cacheKey, MOCK_DESTINATION);
    return MOCK_DESTINATION;
  }
}

export async function nearbyAttractionsProvider(
  params: AttractionSearchParams,
  context: ProviderContext,
  config: ProviderConfig
): Promise<PlacesResult> {
  const key = `places:${JSON.stringify(params)}`;
  const cached = context.cache.get<PlacesResult>(key);
  if (cached) {
    context.providersUsed.add('cache:opentripmap');
    return cached;
  }

  const apiKey = config.openTripMap?.apiKey;
  if (!apiKey) {
    context.providersUsed.add('opentripmap:mock');
    const mockResult: PlacesResult = {
      note:
        'Using curated Chiang Mai attractions. Add an OpenTripMap key for live data.',
      options: MOCK_PLACES.slice(0, params.limit ?? 12)
    };
    context.cache.set(key, mockResult);
    return mockResult;
  }

  try {
    const destination = await resolveDestination(params.destination, context, config);
    const limit = params.limit ?? 12;
    const radiusMeters = 8000;
    const kinds =
      params.tags?.length
        ? params.tags.join(',')
        : DEFAULT_KINDS;

    const url = `https://api.opentripmap.com/0.1/en/places/radius?radius=${radiusMeters}&lon=${destination.lon}&lat=${destination.lat}&limit=${limit}&kinds=${encodeURIComponent(
      kinds
    )}&format=geojson&apikey=${apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(
        `[providers/places] Radius lookup failed ${response.status}, falling back to mock.`
      );
      context.providersUsed.add('opentripmap:mock');
      const mockResult: PlacesResult = {
        note:
          'OpenTripMap request failed, using curated Chiang Mai attractions.',
        options: MOCK_PLACES.slice(0, limit)
      };
      context.cache.set(key, mockResult);
      return mockResult;
    }

    const json = (await response.json()) as { features?: OpenTripMapFeature[] };
    const features = json.features ?? [];

    const options = features
      .filter((feature) => feature.properties.name)
      .map((feature) => {
        const [lon, lat] = feature.geometry.coordinates;
        const kinds = feature.properties.kinds ?? '';
        const name = feature.properties.name;
        const category = mapKindsToCategory(kinds);
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${name} ${lat},${lon}`
        )}`;

        return {
          id: feature.properties.xid ?? feature.id,
          name,
          category,
          lat,
          lon,
          url: mapUrl,
          estMinutes: mapKindsToDuration(kinds)
        };
      })
      .slice(0, limit);

    if (!options.length) {
      context.providersUsed.add('opentripmap:mock');
      const mockResult: PlacesResult = {
        note:
          'OpenTripMap returned no places, using curated Chiang Mai attractions.',
        options: MOCK_PLACES.slice(0, limit)
      };
      context.cache.set(key, mockResult);
      return mockResult;
    }

    const result: PlacesResult = {
      options
    };
    context.providersUsed.add('opentripmap');
    context.cache.set(key, result);
    return result;
  } catch (error) {
    console.error(
      '[providers/places] Nearby attractions error',
      (error as Error).message
    );
    context.providersUsed.add('opentripmap:mock');
    const mockResult: PlacesResult = {
      note:
        'OpenTripMap request errored, using curated Chiang Mai attractions.',
      options: MOCK_PLACES.slice(0, params.limit ?? 12)
    };
    context.cache.set(key, mockResult);
    return mockResult;
  }
}
