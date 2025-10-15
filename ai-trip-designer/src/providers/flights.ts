import type {
  FlightOption,
  FlightSearchParams,
  FlightsResult,
  ProviderConfig,
  ProviderContext
} from '../types';

const MOCK_FLIGHTS: FlightOption[] = [
  {
    carrier: 'Mock Air',
    from: 'AAA',
    to: 'BBB',
    depart: '2025-01-10T08:30:00',
    arrive: '2025-01-10T12:10:00',
    priceUSD: 425,
    link: 'https://example.com/mock-air'
  },
  {
    carrier: 'Sample Airlines',
    from: 'AAA',
    to: 'BBB',
    depart: '2025-01-10T13:45:00',
    arrive: '2025-01-10T17:20:00',
    priceUSD: 468,
    link: 'https://example.com/sample-air'
  },
  {
    carrier: 'Demo Jet',
    from: 'AAA',
    to: 'BBB',
    depart: '2025-01-10T19:15:00',
    arrive: '2025-01-10T22:55:00',
    priceUSD: 512,
    link: 'https://example.com/demo-jet'
  }
];

interface AmadeusTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface AmadeusFlightOffer {
  price?: {
    total?: string;
  };
  itineraries?: Array<{
    segments: Array<{
      departure: { iataCode: string; at: string };
      arrival: { iataCode: string; at: string };
      marketingCarrierCode?: string;
      carrierCode?: string;
    }>;
  }>;
}

const cabinMap: Record<string, string> = {
  economy: 'ECONOMY',
  premium_economy: 'PREMIUM_ECONOMY',
  business: 'BUSINESS',
  first: 'FIRST'
};

async function fetchAmadeusToken(
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(
    'https://test.api.amadeus.com/v1/security/oauth2/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    }
  );

  if (!response.ok) {
    console.warn(
      `[providers/flights] Amadeus token request failed with status ${response.status}`
    );
    return null;
  }

  const json = (await response.json()) as AmadeusTokenResponse;
  return json.access_token;
}

function mapAmadeusOfferToOption(
  offer: AmadeusFlightOffer,
  fallback: FlightSearchParams
): FlightOption | null {
  const price = Number(offer.price?.total ?? NaN);
  const itinerary = offer.itineraries?.[0];
  if (!itinerary) return null;

  const firstSegment = itinerary.segments.at(0);
  const lastSegment = itinerary.segments.at(-1);
  if (!firstSegment || !lastSegment) return null;

  return {
    carrier:
      firstSegment.marketingCarrierCode ??
      firstSegment.carrierCode ??
      'Amadeus Partner',
    from: firstSegment.departure.iataCode ?? fallback.origin,
    to: lastSegment.arrival.iataCode ?? fallback.destination,
    depart: firstSegment.departure.at,
    arrive: lastSegment.arrival.at,
    priceUSD: Number.isFinite(price) ? Math.round(price) : 0,
    link: undefined
  };
}

async function fetchAmadeusFlights(
  params: FlightSearchParams,
  config: ProviderConfig
): Promise<FlightsResult | null> {
  const credentials = config.amadeus;
  if (!credentials?.clientId || !credentials?.clientSecret) {
    return null;
  }

  try {
    const token = await fetchAmadeusToken(
      credentials.clientId,
      credentials.clientSecret
    );
    if (!token) {
      return null;
    }

    const searchParams = new URLSearchParams({
      originLocationCode: params.origin.toUpperCase(),
      destinationLocationCode: params.destination.toUpperCase(),
      departureDate: params.departDate,
      adults: String(params.adults ?? 1),
      currencyCode: 'USD',
      max: '5'
    });

    if (params.returnDate) {
      searchParams.append('returnDate', params.returnDate);
    }
    if (params.cabin) {
      const cabin = cabinMap[params.cabin];
      if (cabin) {
        searchParams.append('travelClass', cabin);
      }
    }

    const response = await fetch(
      `https://test.api.amadeus.com/v2/shopping/flight-offers?${searchParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      console.warn(
        `[providers/flights] Amadeus flight search failed with status ${response.status}`
      );
      return null;
    }

    const json = (await response.json()) as { data?: AmadeusFlightOffer[] };
    const options =
      json.data
        ?.slice(0, 5)
        .map((offer) => mapAmadeusOfferToOption(offer, params))
        .filter((option): option is FlightOption => option !== null) ?? [];

    if (!options.length) {
      return null;
    }

    return {
      options
    };
  } catch (error) {
    console.error(
      '[providers/flights] Amadeus flight search error',
      (error as Error).message
    );
    return null;
  }
}

function buildMockFlights(params: FlightSearchParams): FlightOption[] {
  const schedule = [
    { departHour: 8, arriveHour: 12 },
    { departHour: 13, arriveHour: 17 },
    { departHour: 19, arriveHour: 23 }
  ];

  return MOCK_FLIGHTS.map((flight, index) => {
    const hours = schedule[index] ?? schedule[0];
    const depart = new Date(`${params.departDate}T${String(hours.departHour).padStart(2, '0')}:15:00Z`);
    const arrive = new Date(`${params.departDate}T${String(hours.arriveHour).padStart(2, '0')}:45:00Z`);

    return {
      ...flight,
      carrier: `${flight.carrier} ${String.fromCharCode(65 + index)}`,
      from: params.origin.toUpperCase(),
      to: params.destination.toUpperCase(),
      depart: depart.toISOString(),
      arrive: arrive.toISOString()
    };
  });
}

export async function searchFlightsProvider(
  params: FlightSearchParams,
  context: ProviderContext,
  config: ProviderConfig
): Promise<FlightsResult> {
  const cacheKey = `flights:${JSON.stringify(params)}`;
  const cached = context.cache.get<FlightsResult>(cacheKey);
  if (cached) {
    context.providersUsed.add('cache:flights');
    return cached;
  }

  const liveResult = await fetchAmadeusFlights(params, config);
  if (liveResult) {
    context.providersUsed.add('amadeus');
    context.cache.set(cacheKey, liveResult);
    return liveResult;
  }

  context.providersUsed.add('flights:mock');
  const mockResult: FlightsResult = {
    note:
      'Using mock flight data. Add Amadeus credentials to retrieve live fares.',
    options: buildMockFlights(params)
  };
  context.cache.set(cacheKey, mockResult);
  return mockResult;
}
