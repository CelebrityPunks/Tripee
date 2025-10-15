import express, { Request, Response, Router } from 'express';
import * as mcpSdk from '@modelcontextprotocol/sdk';
import { defaultCache, TTLCache } from './cache';
import {
  AttractionSearchParams,
  FlightSearchParams,
  FlightsResult,
  FlightsToolResult,
  ItineraryDay,
  PlanTripInput,
  PlanTripResult,
  PlaceOption,
  PlacesToolResult,
  ProviderConfig,
  ProviderContext,
  StayOption,
  StaySearchParams,
  StayType,
  StaysToolResult,
  ToolMeta,
  WeatherQueryParams,
  WeatherToolResult
} from './types';
import { searchFlightsProvider } from './providers/flights';
import { searchStaysProvider } from './providers/stays';
import {
  nearbyAttractionsProvider,
  resolveDestination
} from './providers/places';
import { weatherProvider } from './providers/weather';

type ToolValidator<TInput> = (input: unknown) => TInput;
type ToolHandler<TInput, TResult> = (input: TInput) => Promise<TResult>;

interface ToolDefinition<TInput, TResult> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  validate: ToolValidator<TInput>;
  handler: ToolHandler<TInput, TResult>;
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpServerFacade {
  registerTool<TInput, TResult>(definition: ToolDefinition<TInput, TResult>): void;
  listTools(): ToolDescriptor[];
  router: Router;
}

interface TripMcpServerOptions {
  cache?: TTLCache;
  providerConfig?: ProviderConfig;
}

interface CostNotes {
  flights?: string;
  stays?: string;
  places?: string;
  weather?: string;
}

const planTripSchema: Record<string, unknown> = {
  type: 'object',
  required: ['destination', 'startDate'],
  additionalProperties: false,
  properties: {
    origin: {
      type: 'string',
      description: 'IATA code or city for flight search.'
    },
    destination: {
      type: 'string',
      minLength: 2,
      description: 'City name to plan the trip for.'
    },
    startDate: {
      type: 'string',
      format: 'date',
      description: 'ISO date (YYYY-MM-DD) when the trip begins.'
    },
    days: {
      type: 'integer',
      minimum: 1,
      maximum: 21,
      description: 'How many days the itinerary should cover.'
    },
    budgetUSD: {
      type: 'number',
      minimum: 100,
      description: 'Optional overall budget in USD.'
    },
    interests: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Interests to prioritise (e.g. food, nature, culture, nightlife).'
    }
  }
};

const searchFlightsSchema: Record<string, unknown> = {
  type: 'object',
  required: ['origin', 'destination', 'departDate'],
  additionalProperties: false,
  properties: {
    origin: {
      type: 'string',
      minLength: 3,
      description: 'Origin airport or city.'
    },
    destination: {
      type: 'string',
      minLength: 3,
      description: 'Destination airport or city.'
    },
    departDate: {
      type: 'string',
      format: 'date',
      description: 'Departure date (YYYY-MM-DD).'
    },
    returnDate: {
      type: 'string',
      format: 'date',
      description: 'Optional return date.'
    },
    adults: {
      type: 'integer',
      minimum: 1,
      maximum: 9,
      description: 'Number of adult passengers.'
    },
    cabin: {
      type: 'string',
      enum: ['economy', 'premium_economy', 'business', 'first'],
      description: 'Preferred cabin class.'
    }
  }
};

const searchStaysSchema: Record<string, unknown> = {
  type: 'object',
  required: ['destination', 'checkIn', 'nights'],
  additionalProperties: false,
  properties: {
    destination: {
      type: 'string',
      description: 'City or area where accommodation is needed.'
    },
    checkIn: {
      type: 'string',
      format: 'date',
      description: 'Check-in date (YYYY-MM-DD).'
    },
    nights: {
      type: 'integer',
      minimum: 1,
      maximum: 30
    },
    guests: {
      type: 'integer',
      minimum: 1,
      maximum: 6
    }
  }
};

const nearbyAttractionsSchema: Record<string, unknown> = {
  type: 'object',
  required: ['destination'],
  additionalProperties: false,
  properties: {
    destination: {
      type: 'string',
      description: 'City or location to search near.'
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional tags to filter by (food, culture, nature, nightlife, etc.).'
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 30,
      description: 'Number of places to return.'
    }
  }
};

const weatherSchema: Record<string, unknown> = {
  type: 'object',
  required: ['lat', 'lon', 'startDate', 'days'],
  additionalProperties: false,
  properties: {
    lat: {
      type: 'number',
      minimum: -90,
      maximum: 90
    },
    lon: {
      type: 'number',
      minimum: -180,
      maximum: 180
    },
    startDate: {
      type: 'string',
      format: 'date'
    },
    days: {
      type: 'integer',
      minimum: 1,
      maximum: 16
    }
  }
};

const BASE_STYLE = `
  <style>
    .trip-widget {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #101828;
      background: #ffffff;
      border-radius: 16px;
      padding: 20px;
      box-sizing: border-box;
      max-width: 960px;
      margin: 0 auto;
      border: 1px solid rgba(16,24,40,0.08);
      box-shadow: 0 20px 45px -20px rgba(15, 23, 42, 0.25);
    }

    .trip-widget h2, .trip-widget h3 {
      margin: 0 0 12px;
      color: #0f172a;
    }

    .trip-widget .grid {
      display: grid;
      gap: 16px;
    }

    .trip-widget .grid.two {
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }

    .trip-card {
      border: 1px solid rgba(148,163,184,0.4);
      border-radius: 14px;
      padding: 16px;
      background: linear-gradient(180deg, rgba(248,250,252,0.95) 0%, #ffffff 100%);
    }

    .trip-metadata {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 0.9rem;
      color: #475467;
      margin-bottom: 16px;
    }

    .trip-pills {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .trip-pill {
      padding: 4px 10px;
      background: rgba(59,130,246,0.08);
      border-radius: 999px;
      color: #1d4ed8;
      font-size: 0.85rem;
    }

    .trip-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }

    .trip-table th,
    .trip-table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid rgba(148,163,184,0.3);
      font-size: 0.92rem;
    }

    .trip-table th {
      color: #334155;
      background: rgba(226,232,240,0.35);
    }

    .trip-section {
      margin-top: 28px;
    }

    .trip-section:first-of-type {
      margin-top: 0;
    }

    .trip-small {
      font-size: 0.85rem;
      color: #475467;
    }

    .trip-itinerary-block {
      border-left: 3px solid rgba(59,130,246,0.4);
      padding-left: 12px;
      margin-bottom: 10px;
    }

    .trip-itinerary-block ul {
      margin: 4px 0 0 0;
      padding-left: 18px;
    }

    .trip-itinerary-block li {
      margin-bottom: 4px;
    }

    .trip-price {
      font-weight: 600;
      color: #1f2937;
      font-size: 1.05rem;
    }

    .trip-note {
      background: rgba(245,158,11,0.12);
      color: #92400e;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 0.9rem;
      margin-top: 10px;
    }

    .trip-link {
      color: #2563eb;
      text-decoration: none;
      font-weight: 500;
    }

    .trip-link:hover {
      text-decoration: underline;
    }

    @media (max-width: 640px) {
      .trip-widget {
        border-radius: 12px;
        padding: 16px;
      }
    }
  </style>
`;

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: 'numeric',
  timeZoneName: 'short'
});

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

function coerceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function validateISODate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`\`${field}\` must be in YYYY-MM-DD format.`);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`\`${field}\` must be a valid date.`);
  }
}

function validatePlanTripInput(input: unknown): PlanTripInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Input must be an object.');
  }

  const {
    origin,
    destination,
    startDate,
    days,
    budgetUSD,
    interests
  } = input as Record<string, unknown>;

  const resolvedDestination = coerceString(destination);
  if (!resolvedDestination) {
    throw new Error('`destination` is required.');
  }

  const resolvedStartDate = coerceString(startDate);
  if (!resolvedStartDate) {
    throw new Error('`startDate` is required.');
  }
  validateISODate(resolvedStartDate, 'startDate');

  let resolvedDays = 4;
  if (typeof days !== 'undefined') {
    const numericDays = Number(days);
    if (!Number.isInteger(numericDays) || numericDays < 1) {
      throw new Error('`days` must be a positive integer.');
    }
    resolvedDays = numericDays;
  }

  let resolvedBudget: number | undefined;
  if (typeof budgetUSD !== 'undefined') {
    const numericBudget = Number(budgetUSD);
    if (!Number.isFinite(numericBudget) || numericBudget < 0) {
      throw new Error('`budgetUSD` must be a positive number.');
    }
    resolvedBudget = numericBudget;
  }

  let resolvedInterests: string[] | undefined;
  if (Array.isArray(interests)) {
    const filtered = interests
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    resolvedInterests = filtered.length ? filtered : undefined;
  }

  const resolvedOrigin = coerceString(origin);

  return {
    origin: resolvedOrigin,
    destination: resolvedDestination,
    startDate: resolvedStartDate,
    days: resolvedDays,
    budgetUSD: resolvedBudget,
    interests: resolvedInterests
  };
}

function validateFlightSearchInput(input: unknown): FlightSearchParams {
  if (!input || typeof input !== 'object') {
    throw new Error('Input must be an object.');
  }

  const {
    origin,
    destination,
    departDate,
    returnDate,
    adults,
    cabin
  } = input as Record<string, unknown>;

  const resolvedOrigin = coerceString(origin);
  const resolvedDestination = coerceString(destination);
  if (!resolvedOrigin || !resolvedDestination) {
    throw new Error('`origin` and `destination` are required.');
  }

  const resolvedDepartDate = coerceString(departDate);
  if (!resolvedDepartDate) {
    throw new Error('`departDate` is required.');
  }
  validateISODate(resolvedDepartDate, 'departDate');

  let resolvedReturnDate: string | undefined;
  if (typeof returnDate !== 'undefined') {
    const returnStr = coerceString(returnDate);
    if (!returnStr) {
      throw new Error('`returnDate` must be a valid string.');
    }
    validateISODate(returnStr, 'returnDate');
    resolvedReturnDate = returnStr;
  }

  let resolvedAdults: number | undefined;
  if (typeof adults !== 'undefined') {
    const numericAdults = Number(adults);
    if (!Number.isInteger(numericAdults) || numericAdults < 1) {
      throw new Error('`adults` must be a positive integer.');
    }
    resolvedAdults = numericAdults;
  }

  let resolvedCabin: FlightSearchParams['cabin'] | undefined;
  if (typeof cabin !== 'undefined') {
    const cabinStr = coerceString(cabin);
    const allowed = ['economy', 'premium_economy', 'business', 'first'];
    if (!cabinStr || !allowed.includes(cabinStr)) {
      throw new Error(
        '`cabin` must be one of economy, premium_economy, business, or first.'
      );
    }
    resolvedCabin = cabinStr as FlightSearchParams['cabin'];
  }

  return {
    origin: resolvedOrigin,
    destination: resolvedDestination,
    departDate: resolvedDepartDate,
    returnDate: resolvedReturnDate,
    adults: resolvedAdults,
    cabin: resolvedCabin
  };
}

function validateStaySearchInput(input: unknown): StaySearchParams {
  if (!input || typeof input !== 'object') {
    throw new Error('Input must be an object.');
  }

  const { destination, checkIn, nights, guests } = input as Record<
    string,
    unknown
  >;

  const resolvedDestination = coerceString(destination);
  if (!resolvedDestination) {
    throw new Error('`destination` is required.');
  }

  const resolvedCheckIn = coerceString(checkIn);
  if (!resolvedCheckIn) {
    throw new Error('`checkIn` is required.');
  }
  validateISODate(resolvedCheckIn, 'checkIn');

  const resolvedNights = Number(nights);
  if (!Number.isInteger(resolvedNights) || resolvedNights < 1) {
    throw new Error('`nights` must be a positive integer.');
  }

  let resolvedGuests: number | undefined;
  if (typeof guests !== 'undefined') {
    const numericGuests = Number(guests);
    if (!Number.isInteger(numericGuests) || numericGuests < 1) {
      throw new Error('`guests` must be a positive integer when provided.');
    }
    resolvedGuests = numericGuests;
  }

  return {
    destination: resolvedDestination,
    checkIn: resolvedCheckIn,
    nights: resolvedNights,
    guests: resolvedGuests
  };
}

function validateNearbyAttractionsInput(
  input: unknown
): AttractionSearchParams {
  if (!input || typeof input !== 'object') {
    throw new Error('Input must be an object.');
  }

  const { destination, tags, limit } = input as Record<string, unknown>;

  const resolvedDestination = coerceString(destination);
  if (!resolvedDestination) {
    throw new Error('`destination` is required.');
  }

  let resolvedTags: string[] | undefined;
  if (Array.isArray(tags)) {
    const filtered = tags
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    resolvedTags = filtered.length ? filtered : undefined;
  }

  let resolvedLimit: number | undefined;
  if (typeof limit !== 'undefined') {
    const numericLimit = Number(limit);
    if (!Number.isInteger(numericLimit) || numericLimit < 1) {
      throw new Error('`limit` must be a positive integer.');
    }
    resolvedLimit = numericLimit;
  }

  return {
    destination: resolvedDestination,
    tags: resolvedTags,
    limit: resolvedLimit
  };
}

function validateWeatherInput(input: unknown): WeatherQueryParams {
  if (!input || typeof input !== 'object') {
    throw new Error('Input must be an object.');
  }

  const { lat, lon, startDate, days } = input as Record<string, unknown>;

  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('`lat` must be between -90 and 90.');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('`lon` must be between -180 and 180.');
  }

  const resolvedStartDate = coerceString(startDate);
  if (!resolvedStartDate) {
    throw new Error('`startDate` is required.');
  }
  validateISODate(resolvedStartDate, 'startDate');

  const resolvedDays = Number(days);
  if (!Number.isInteger(resolvedDays) || resolvedDays < 1) {
    throw new Error('`days` must be a positive integer.');
  }

  return {
    lat: latitude,
    lon: longitude,
    startDate: resolvedStartDate,
    days: resolvedDays
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value: string): string {
  return DATE_FORMATTER.format(new Date(value));
}

function formatTime(value: string): string {
  return TIME_FORMATTER.format(new Date(value));
}

function addDays(base: string, offset: number): string {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().substring(0, 10);
}

function createProviderContext(cache: TTLCache): ProviderContext {
  return {
    cache,
    providersUsed: new Set()
  };
}

function providersFromContext(context: ProviderContext): ToolMeta {
  const providers = Array.from(context.providersUsed);

  const readableProviders = providers
    .filter((name) => !name.startsWith('cache:'))
    .map((name) => formatProviderName(name));

  const cached = providers.some((name) => name.startsWith('cache:'));

  return {
    generatedAt: new Date().toISOString(),
    providers: readableProviders.length ? readableProviders : ['mock-data'],
    cached
  };
}

function formatProviderName(name: string): string {
  const map: Record<string, string> = {
    amadeus: 'Amadeus',
    'opentripmap:mock': 'OpenTripMap (mock)',
    opentripmap: 'OpenTripMap',
    'stays:mock': 'Mock stays',
    'flights:mock': 'Mock flights',
    'weather:mock': 'Weather (mock)',
    'open-meteo': 'Open-Meteo'
  };
  if (map[name]) {
    return map[name];
  }
  return name.replace(/cache:/, 'cache→');
}

function selectStayTiers(options: StayOption[]): StayOption[] {
  const desiredTypes: StayType[] = ['budget', 'mid', 'premium'];
  const result: StayOption[] = [];

  for (const type of desiredTypes) {
    const stay =
      options.find((option) => option.type === type) ?? options.find(() => true);
    if (stay) {
      result.push(stay);
    }
  }

  return result;
}

function computeCostEstimate(
  days: number,
  stays: StayOption[],
  flights: FlightsResult | undefined,
  budget: number | undefined,
  originProvided: boolean,
  notes: CostNotes
) {
  const flightPrices = flights?.options
    ?.map((option) => option.priceUSD)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  const flightLow = flightPrices?.[0] ?? (originProvided ? 0 : 0);
  const flightMid = flightPrices?.[Math.min(1, (flightPrices?.length ?? 1) - 1)] ?? flightLow;
  const flightHigh = flightPrices?.[Math.min(2, (flightPrices?.length ?? 1) - 1)] ?? flightMid;

  const stayLookup = new Map<StayType, StayOption>();
  stays.forEach((stay) => stayLookup.set(stay.type, stay));

  const stayBudget = stayLookup.get('budget')?.totalUSD ?? 0;
  const stayMid = stayLookup.get('mid')?.totalUSD ?? stayBudget;
  const stayPremium = stayLookup.get('premium')?.totalUSD ?? stayMid;

  const dailySpendLow = 45;
  const dailySpendMid = 75;
  const dailySpendHigh = 130;

  const activityLow = dailySpendLow * days;
  const activityMid = dailySpendMid * days;
  const activityHigh = dailySpendHigh * days;

  const lowUSD = Math.round(flightLow + stayBudget + activityLow);
  const midUSD = Math.round(flightMid + stayMid + activityMid);
  const highUSD = Math.round(flightHigh + stayPremium + activityHigh);

  const costNotes: string[] = [
    `Daily activity budgets: $${dailySpendLow}/${dailySpendMid}/${dailySpendHigh} (low/mid/high).`
  ];

  if (budget) {
    costNotes.push(`Target budget: ${formatCurrency(budget)}.`);
    costNotes.push(
      `Mid-range estimate is ${midUSD <= budget ? 'within' : 'above'} budget.`
    );
  }
  if (notes.flights) costNotes.push(notes.flights);
  if (notes.stays) costNotes.push(notes.stays);
  if (notes.places) costNotes.push(notes.places);
  if (notes.weather) costNotes.push(notes.weather);

  return {
    lowUSD,
    midUSD,
    highUSD,
    notes: costNotes
  };
}

function groupPlacesForItinerary(
  startDate: string,
  days: number,
  places: PlaceOption[],
  interests: string[] | undefined
): ItineraryDay[] {
  const interestSet = new Set((interests ?? []).map((item) => item.toLowerCase()));

  const scoredPlaces = places
    .map((place) => ({
      place,
      score: computeInterestScore(place, interestSet)
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.place);

  const itinerary: ItineraryDay[] = [];
  const queue = [...scoredPlaces];

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = addDays(startDate, dayIndex);
    const morning = queue.shift();
    const afternoon = queue.shift();
    const evening = queue.shift();

    const slots: ItineraryDay = {
      day: dayIndex + 1,
      date,
      morning: morning
        ? [`Start at ${morning.name} (${morning.category}, ~${morning.estMinutes ?? 90} mins)`]
        : ['Leisurely breakfast and walking tour of the Old City'],
      afternoon: afternoon
        ? [`Afternoon at ${afternoon.name} (${afternoon.category}, ~${afternoon.estMinutes ?? 90} mins)`]
        : ['Street food crawl & coffee tasting'],
      evening: evening
        ? [`Evening at ${evening.name} (${evening.category})`]
        : ['Night market stroll & live music'],
      mapUrl: morning?.url ?? afternoon?.url ?? evening?.url
    };

    if (morning && evening && morning.category === evening.category) {
      slots.evening[0] += ' with a sunset twist';
    }

    itinerary.push(slots);
  }

  return itinerary;
}

function computeInterestScore(place: PlaceOption, interests: Set<string>): number {
  if (!interests.size) {
    return 1;
  }

  const base = 1;
  let score = base;
  interests.forEach((interest) => {
    if (place.category.toLowerCase().includes(interest)) {
      score += 2;
    }
    if (place.name.toLowerCase().includes(interest)) {
      score += 1.5;
    }
  });

  return score;
}

function renderPlanTripHtml(result: PlanTripResult): string {
  const flightsHtml = renderFlightsSection(result.flights);
  const staysHtml = renderStaysSection(result.stays);
  const placesHtml = renderPlacesSection(result.places.slice(0, 8));
  const weatherHtml = renderWeatherSection(result.weather);
  const itineraryHtml = renderItinerarySection(result.itinerary);
  const costHtml = renderCostSection(result.costEstimate);

  const interests = result.itinerary
    .flatMap((day) => [...day.morning, ...day.afternoon, ...day.evening])
    .slice(0, 6)
    .map((item) => `<span class="trip-pill">${escapeHtml(item.split('(')[0].trim())}</span>`)
    .join('');

  return `
    <section class="trip-widget" aria-label="AI Trip Designer Plan">
      ${BASE_STYLE}
      <header>
        <h2>Trip to ${escapeHtml(result.destination.name)}, ${escapeHtml(result.destination.country)}</h2>
        <div class="trip-metadata">
          <span>${formatDate(result.dates.start)} → ${formatDate(result.dates.end)}</span>
          <span>${result.dates.days} days</span>
        </div>
        <div class="trip-pills" aria-label="Highlights">
          ${interests}
        </div>
      </header>
      <div class="trip-section">${flightsHtml}</div>
      <div class="trip-section">${staysHtml}</div>
      <div class="trip-section">${weatherHtml}</div>
      <div class="trip-section">${placesHtml}</div>
      <div class="trip-section">${itineraryHtml}</div>
      <div class="trip-section">${costHtml}</div>
      <footer class="trip-small" style="margin-top: 18px;">
        Generated ${new Date(result.meta.generatedAt).toLocaleString()} • Sources: ${result.meta.providers.join(
          ', '
        )}${result.meta.cached ? ' • cached' : ''}
      </footer>
    </section>
  `;
}

function renderFlightsSection(flights?: FlightsResult): string {
  if (!flights) {
    return '<h3>Flights</h3><p class="trip-small">No flight search configured.</p>';
  }

  const cards = flights.options
    .map(
      (flight) => `
        <article class="trip-card" role="group" aria-label="${escapeHtml(flight.carrier)} flight">
          <h4 style="margin-top:0;">${escapeHtml(flight.carrier)}</h4>
          <p class="trip-price">${formatCurrency(flight.priceUSD)}</p>
          <p class="trip-small">${escapeHtml(flight.from)} → ${escapeHtml(flight.to)}</p>
          <p class="trip-small">${formatTime(flight.depart)} → ${formatTime(flight.arrive)}</p>
          ${
            flight.link
              ? `<a class="trip-link" href="${escapeHtml(
                  flight.link
                )}" target="_blank" rel="noopener">View booking</a>`
              : ''
          }
        </article>
      `
    )
    .join('');

  const note = flights.note
    ? `<div class="trip-note">${escapeHtml(flights.note)}</div>`
    : '';

  return `
    <h3>Flights</h3>
    <div class="grid two">
      ${cards || '<p class="trip-small">No flights available for this search.</p>'}
    </div>
    ${note}
  `;
}

function renderStaysSection(stays: StayOption[]): string {
  const cards = stays
    .map(
      (stay) => `
        <article class="trip-card" role="group" aria-label="${escapeHtml(stay.name)} stay">
          <div class="trip-pills" style="margin-bottom: 8px;">
            <span class="trip-pill">${escapeHtml(stay.type)}</span>
            ${typeof stay.rating === 'number' ? `<span class="trip-pill">★ ${stay.rating.toFixed(1)}</span>` : ''}
          </div>
          <h4 style="margin: 0 0 6px 0;">${escapeHtml(stay.name)}</h4>
          <p class="trip-small">${stay.address ? escapeHtml(stay.address) : ''}</p>
          <p class="trip-price">${formatCurrency(stay.pricePerNightUSD)} <span class="trip-small">/ night</span></p>
          <p class="trip-small">Total: ${formatCurrency(stay.totalUSD)}</p>
          ${
            stay.link
              ? `<a class="trip-link" href="${escapeHtml(
                  stay.link
                )}" target="_blank" rel="noopener">View property</a>`
              : ''
          }
        </article>
      `
    )
    .join('');

  return `
    <h3>Stay Options</h3>
    <div class="grid two">${cards}</div>
  `;
}

function renderPlacesSection(places: PlaceOption[]): string {
  const items = places
    .map(
      (place) => `
        <article class="trip-card" role="group" aria-label="${escapeHtml(place.name)}">
          <div class="trip-pills" style="margin-bottom: 6px;">
            <span class="trip-pill">${escapeHtml(place.category)}</span>
            ${place.estMinutes ? `<span class="trip-pill">~${place.estMinutes} mins</span>` : ''}
          </div>
          <h4 style="margin: 0 0 4px 0;">${escapeHtml(place.name)}</h4>
          <p class="trip-small">${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}</p>
          ${
            place.url
              ? `<a class="trip-link" href="${escapeHtml(
                  place.url
                )}" target="_blank" rel="noopener">Open in Google Maps</a>`
              : ''
          }
        </article>
      `
    )
    .join('');

  return `
    <h3>Attractions & Food</h3>
    <div class="grid two">${items}</div>
  `;
}

function renderWeatherSection(weather: WeatherToolResult | { daily: { date: string; hiC: number; loC: number; precipProb?: number }[] }): string {
  const rows = weather.daily
    .map(
      (day) => `
        <tr>
          <td>${formatDate(day.date)}</td>
          <td>${Math.round(day.hiC)}° / ${Math.round(day.loC)}°C</td>
          <td>${day.precipProb ?? 0}%</td>
        </tr>
      `
    )
    .join('');

  return `
    <h3>Weather Snapshot</h3>
    <table class="trip-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Hi / Lo</th>
          <th>Rain</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderItinerarySection(itinerary: ItineraryDay[]): string {
  const cards = itinerary
    .map((day) => {
      const morning = day.morning.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const afternoon = day.afternoon.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const evening = day.evening.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

      return `
        <article class="trip-card" aria-label="Day ${day.day} itinerary">
          <h4 style="margin-top:0;">Day ${day.day} · ${formatDate(day.date)}</h4>
          <div class="trip-itinerary-block">
            <strong>Morning</strong>
            <ul>${morning}</ul>
          </div>
          <div class="trip-itinerary-block">
            <strong>Afternoon</strong>
            <ul>${afternoon}</ul>
          </div>
          <div class="trip-itinerary-block">
            <strong>Evening</strong>
            <ul>${evening}</ul>
          </div>
          ${
            day.mapUrl
              ? `<a class="trip-link" href="${escapeHtml(
                  day.mapUrl
                )}" target="_blank" rel="noopener">View custom map</a>`
              : ''
          }
        </article>
      `;
    })
    .join('');

  return `
    <h3>Day-by-Day Plan</h3>
    <div class="grid">${cards}</div>
  `;
}

function renderCostSection(costEstimate: PlanTripResult['costEstimate']): string {
  const notes = costEstimate.notes
    ?.map((note) => `<li>${escapeHtml(note)}</li>`)
    .join('');

  return `
    <h3>Cost Estimate</h3>
    <div class="trip-card">
      <p><strong>Low:</strong> ${formatCurrency(costEstimate.lowUSD)}</p>
      <p><strong>Mid:</strong> ${formatCurrency(costEstimate.midUSD)}</p>
      <p><strong>High:</strong> ${formatCurrency(costEstimate.highUSD)}</p>
      ${
        notes
          ? `<details style="margin-top:12px;">
              <summary>Notes</summary>
              <ul>${notes}</ul>
            </details>`
          : ''
      }
    </div>
  `;
}

function renderFlightsHtml(result: FlightsToolResult): string {
  return `
    <section class="trip-widget">
      ${BASE_STYLE}
      <h3>Flight Options</h3>
      ${renderFlightsSection(result)}
      <footer class="trip-small" style="margin-top: 12px;">
        Generated ${new Date(result.meta.generatedAt).toLocaleString()} • Sources: ${result.meta.providers.join(
          ', '
        )}${result.meta.cached ? ' • cached' : ''}
      </footer>
    </section>
  `;
}

function renderStaysHtml(result: StaysToolResult): string {
  return `
    <section class="trip-widget">
      ${BASE_STYLE}
      <h3>Stay Suggestions</h3>
      ${renderStaysSection(result.options.slice(0, 6))}
      ${
        result.note
          ? `<div class="trip-note" style="margin-top: 16px;">${escapeHtml(result.note)}</div>`
          : ''
      }
      <footer class="trip-small" style="margin-top: 12px;">
        Generated ${new Date(result.meta.generatedAt).toLocaleString()} • Sources: ${result.meta.providers.join(
          ', '
        )}${result.meta.cached ? ' • cached' : ''}
      </footer>
    </section>
  `;
}

function renderPlacesHtml(result: PlacesToolResult): string {
  return `
    <section class="trip-widget">
      ${BASE_STYLE}
      <h3>Nearby Highlights</h3>
      ${renderPlacesSection(result.options)}
      ${
        result.note
          ? `<div class="trip-note" style="margin-top: 16px;">${escapeHtml(result.note)}</div>`
          : ''
      }
      <footer class="trip-small" style="margin-top: 12px;">
        Generated ${new Date(result.meta.generatedAt).toLocaleString()} • Sources: ${result.meta.providers.join(
          ', '
        )}${result.meta.cached ? ' • cached' : ''}
      </footer>
    </section>
  `;
}

function renderWeatherHtml(result: WeatherToolResult): string {
  return `
    <section class="trip-widget">
      ${BASE_STYLE}
      <h3>Weather Outlook</h3>
      ${renderWeatherSection(result)}
      <footer class="trip-small" style="margin-top: 12px;">
        Generated ${new Date(result.meta.generatedAt).toLocaleString()} • Source: ${result.meta.providers.join(
          ', '
        )}${result.meta.cached ? ' • cached' : ''}
      </footer>
    </section>
  `;
}

class TripToolset {
  constructor(
    private readonly providerConfig: ProviderConfig,
    private readonly cache: TTLCache
  ) {}

  async planTrip(input: PlanTripInput): Promise<PlanTripResult> {
    const days = input.days ?? 4;
    const context = createProviderContext(this.cache);
    const notes: CostNotes = {};

    const destination = await resolveDestination(
      input.destination,
      context,
      this.providerConfig
    );

    const tripDates = {
      start: input.startDate,
      end: addDays(input.startDate, days - 1),
      days
    };

    const weather = await weatherProvider(
      {
        lat: destination.lat,
        lon: destination.lon,
        startDate: input.startDate,
        days
      },
      context,
      this.providerConfig
    );

    let flights: FlightsResult | undefined;
    if (input.origin) {
      flights = await searchFlightsProvider(
        {
          origin: input.origin,
          destination: destination.name,
          departDate: input.startDate,
          adults: 1
        },
        context,
        this.providerConfig
      );
      if (flights.note) {
        notes.flights = flights.note;
      }
    } else {
      flights = {
        note: 'No origin provided.',
        options: []
      };
    }

    const staysResult = await searchStaysProvider(
      {
        destination: destination.name,
        checkIn: input.startDate,
        nights: days
      },
      context,
      this.providerConfig
    );
    if (staysResult.note) {
      notes.stays = staysResult.note;
    }

    const stayOptions = selectStayTiers(staysResult.options);

    const placesResult = await nearbyAttractionsProvider(
      {
        destination: destination.name,
        tags: input.interests,
        limit: Math.max(12, days * 3)
      },
      context,
      this.providerConfig
    );
    if (placesResult.note) {
      notes.places = placesResult.note;
    }

    const itinerary = groupPlacesForItinerary(
      input.startDate,
      days,
      placesResult.options,
      input.interests
    );

    const costEstimate = computeCostEstimate(
      days,
      stayOptions,
      flights,
      input.budgetUSD,
      Boolean(input.origin),
      notes
    );

    const meta = providersFromContext(context);

    const plan: PlanTripResult = {
      destination,
      dates: tripDates,
      weather,
      flights,
      stays: stayOptions,
      places: placesResult.options,
      itinerary,
      costEstimate,
      html: '',
      meta
    };
    plan.html = renderPlanTripHtml(plan);
    return plan;
  }

  async searchFlights(input: FlightSearchParams): Promise<FlightsToolResult> {
    const context = createProviderContext(this.cache);
    const flights = await searchFlightsProvider(input, context, this.providerConfig);
    const meta = providersFromContext(context);
    const result: FlightsToolResult = {
      ...flights,
      html: '',
      meta
    };
    result.html = renderFlightsHtml(result);
    return result;
  }

  async searchStays(input: StaySearchParams): Promise<StaysToolResult> {
    const context = createProviderContext(this.cache);
    const stays = await searchStaysProvider(input, context, this.providerConfig);
    const meta = providersFromContext(context);
    const result: StaysToolResult = {
      ...stays,
      html: '',
      meta
    };
    result.html = renderStaysHtml(result);
    return result;
  }

  async nearbyAttractions(
    input: AttractionSearchParams
  ): Promise<PlacesToolResult> {
    const context = createProviderContext(this.cache);
    const places = await nearbyAttractionsProvider(
      input,
      context,
      this.providerConfig
    );
    const meta = providersFromContext(context);
    const result: PlacesToolResult = {
      ...places,
      html: '',
      meta
    };
    result.html = renderPlacesHtml(result);
    return result;
  }

  async weather(input: WeatherQueryParams): Promise<WeatherToolResult> {
    const context = createProviderContext(this.cache);
    const snapshot = await weatherProvider(input, context, this.providerConfig);
    const meta = providersFromContext(context);
    const result: WeatherToolResult = {
      ...snapshot,
      html: '',
      meta
    };
    result.html = renderWeatherHtml(result);
    return result;
  }
}

class TripMcpServer implements McpServerFacade {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();
  private readonly routerInternal: Router;
  private readonly underlyingServer: {
    registerTool?: (tool: unknown) => unknown;
    createRouter?: () => Router;
    listTools?: () => ToolDescriptor[];
  } | null;

  constructor(
    private readonly toolset: TripToolset,
    private readonly options: TripMcpServerOptions
  ) {
    this.routerInternal = express.Router();
    this.underlyingServer = this.tryCreateUnderlyingServer();

    this.routerInternal.get('/tools', this.handleListTools);
    this.routerInternal.post('/call', this.handleCallTool);
    this.routerInternal.post('/tools/:toolName', this.handleInvokeTool);

    if (this.underlyingServer?.createRouter) {
      try {
        const underlyingRouter = this.underlyingServer.createRouter();
        if (underlyingRouter) {
          this.routerInternal.use('/sdk', underlyingRouter);
        }
      } catch (error) {
        console.warn(
          '[mcp] Failed to attach underlying SDK router:',
          (error as Error).message
        );
      }
    }
  }

  registerTool<TInput, TResult>(
    definition: ToolDefinition<TInput, TResult>
  ): void {
    this.tools.set(definition.name, definition as ToolDefinition<unknown, unknown>);

    if (this.underlyingServer?.registerTool) {
      try {
        this.underlyingServer.registerTool({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
          handler: definition.handler
        });
      } catch (error) {
        console.warn(
          `[mcp] Failed to register tool "${definition.name}" with SDK:`,
          (error as Error).message
        );
      }
    }
  }

  listTools(): ToolDescriptor[] {
    const localTools = Array.from(this.tools.values()).map(
      (tool): ToolDescriptor => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      })
    );

    if (this.underlyingServer?.listTools) {
      try {
        return this.underlyingServer.listTools() ?? localTools;
      } catch (error) {
        console.warn(
          '[mcp] Failed to list tools from SDK:',
          (error as Error).message
        );
      }
    }

    return localTools;
  }

  get router(): Router {
    return this.routerInternal;
  }

  private handleListTools = (_req: Request, res: Response) => {
    res.json({
      tools: this.listTools()
    });
  };

  private handleCallTool = async (req: Request, res: Response) => {
    const { tool: toolName, arguments: args } = req.body ?? {};
    if (!toolName || typeof toolName !== 'string') {
      res.status(400).json({ error: '`tool` must be provided.' });
      return;
    }
    await this.executeTool(toolName, args, res);
  };

  private handleInvokeTool = async (req: Request, res: Response) => {
    const toolName = req.params.toolName;
    const input = req.body;
    await this.executeTool(toolName, input, res);
  };

  private async executeTool(toolName: string, rawInput: unknown, res: Response) {
    const definition = this.tools.get(toolName);
    if (!definition) {
      res.status(404).json({ error: `Unknown tool: ${toolName}` });
      return;
    }
    try {
      const input = definition.validate(rawInput);
      const result = await definition.handler.call(this.toolset, input);
      res.json({
        tool: toolName,
        result
      });
    } catch (error) {
      res.status(400).json({
        error: (error as Error).message,
        tool: toolName
      });
    }
  }

  private tryCreateUnderlyingServer() {
    const maybeCreateServer =
      (mcpSdk as { createServer?: (options: { name: string; version: string; description?: string }) => unknown })
        .createServer;
    if (typeof maybeCreateServer !== 'function') {
      return null;
    }
    try {
      const server = maybeCreateServer({
        name: 'ai-trip-designer',
        version: '0.1.0',
        description: 'AI Trip Designer MCP tools.'
      }) as {
        registerTool?: (tool: unknown) => unknown;
        createRouter?: () => Router;
        listTools?: () => ToolDescriptor[];
      };
      return server ?? null;
    } catch (error) {
      console.warn(
        '[mcp] Failed to instantiate SDK server:',
        (error as Error).message
      );
      return null;
    }
  }
}

function resolveProviderConfigFromEnv(): ProviderConfig {
  const env = process.env;
  const config: ProviderConfig = {};

  if (env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET) {
    config.amadeus = {
      clientId: env.AMADEUS_CLIENT_ID,
      clientSecret: env.AMADEUS_CLIENT_SECRET
    };
  }
  if (env.SKYSCANNER_API_KEY) {
    config.skyscanner = {
      apiKey: env.SKYSCANNER_API_KEY
    };
  }
  if (env.BOOKING_RAPIDAPI_KEY) {
    config.booking = {
      rapidApiKey: env.BOOKING_RAPIDAPI_KEY
    };
  }
  if (env.OPENTRIPMAP_API_KEY) {
    config.openTripMap = {
      apiKey: env.OPENTRIPMAP_API_KEY
    };
  }

  return config;
}

export function createTripMcpServer(
  options: TripMcpServerOptions = {}
): McpServerFacade {
  const cache = options.cache ?? defaultCache;
  const providerConfig =
    options.providerConfig ?? resolveProviderConfigFromEnv();
  const toolset = new TripToolset(providerConfig, cache);
  const server = new TripMcpServer(toolset, { cache, providerConfig });

  server.registerTool<PlanTripInput, PlanTripResult>({
    name: 'planTrip',
    description: 'Plan a multi-day trip with itinerary, costs, and HTML summary.',
    inputSchema: planTripSchema,
    validate: validatePlanTripInput,
    handler: toolset.planTrip.bind(toolset)
  });

  server.registerTool<FlightSearchParams, FlightsToolResult>({
    name: 'searchFlights',
    description: 'Search for flight options between two cities.',
    inputSchema: searchFlightsSchema,
    validate: validateFlightSearchInput,
    handler: toolset.searchFlights.bind(toolset)
  });

  server.registerTool<StaySearchParams, StaysToolResult>({
    name: 'searchStays',
    description: 'Search for stay options with nightly pricing.',
    inputSchema: searchStaysSchema,
    validate: validateStaySearchInput,
    handler: toolset.searchStays.bind(toolset)
  });

  server.registerTool<AttractionSearchParams, PlacesToolResult>({
    name: 'nearbyAttractions',
    description: 'Discover nearby attractions and food spots.',
    inputSchema: nearbyAttractionsSchema,
    validate: validateNearbyAttractionsInput,
    handler: toolset.nearbyAttractions.bind(toolset)
  });

  server.registerTool<WeatherQueryParams, WeatherToolResult>({
    name: 'weather',
    description: 'Fetch weather outlook for a location and date range.',
    inputSchema: weatherSchema,
    validate: validateWeatherInput,
    handler: toolset.weather.bind(toolset)
  });

  return server;
}
