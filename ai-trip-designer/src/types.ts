export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

export interface PlanTripInput {
  origin?: string;
  destination: string;
  startDate: string;
  days?: number;
  budgetUSD?: number;
  interests?: string[];
}

export interface DestinationInfo {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export interface TripDates {
  start: string;
  end: string;
  days: number;
}

export interface WeatherDay {
  date: string;
  hiC: number;
  loC: number;
  precipProb?: number;
}

export interface WeatherSnapshot {
  daily: WeatherDay[];
}

export interface FlightOption {
  carrier: string;
  from: string;
  to: string;
  depart: string;
  arrive: string;
  priceUSD: number;
  link?: string;
}

export interface FlightsResult {
  note?: string;
  options: FlightOption[];
}

export type StayType = 'budget' | 'mid' | 'premium';

export interface StayOption {
  name: string;
  type: StayType;
  pricePerNightUSD: number;
  totalUSD: number;
  rating?: number;
  address?: string;
  link?: string;
}

export interface StaysResult {
  note?: string;
  options: StayOption[];
}

export interface PlaceOption {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  url?: string;
  estMinutes?: number;
}

export interface PlacesResult {
  note?: string;
  options: PlaceOption[];
}

export interface ItineraryDay {
  day: number;
  date: string;
  morning: string[];
  afternoon: string[];
  evening: string[];
  mapUrl?: string;
}

export interface CostEstimate {
  lowUSD: number;
  midUSD: number;
  highUSD: number;
  notes?: string[];
}

export interface PlanTripResult {
  destination: DestinationInfo;
  dates: TripDates;
  weather: WeatherSnapshot;
  flights?: FlightsResult;
  stays: StayOption[];
  places: PlaceOption[];
  itinerary: ItineraryDay[];
  costEstimate: CostEstimate;
  html: string;
  meta: ToolMeta;
}

export interface ToolMeta {
  generatedAt: string;
  providers: string[];
  cached: boolean;
}

export interface FlightsToolResult extends FlightsResult {
  html: string;
  meta: ToolMeta;
}

export interface StaysToolResult extends StaysResult {
  html: string;
  meta: ToolMeta;
}

export interface PlacesToolResult extends PlacesResult {
  html: string;
  meta: ToolMeta;
}

export interface WeatherToolResult extends WeatherSnapshot {
  html: string;
  meta: ToolMeta;
}

export interface FlightSearchParams {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  adults?: number;
  cabin?: CabinClass;
}

export interface StaySearchParams {
  destination: string;
  checkIn: string;
  nights: number;
  guests?: number;
}

export interface AttractionSearchParams {
  destination: string;
  tags?: string[];
  limit?: number;
}

export interface WeatherQueryParams {
  lat: number;
  lon: number;
  startDate: string;
  days: number;
}

export interface ProviderConfig {
  amadeus?: {
    clientId: string;
    clientSecret: string;
  };
  skyscanner?: {
    apiKey: string;
  };
  booking?: {
    rapidApiKey: string;
  };
  openTripMap?: {
    apiKey: string;
  };
}

export interface CacheOptions {
  ttlMs?: number;
}

export interface CacheLike {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, options?: CacheOptions): void;
}

export interface ProviderContext {
  cache: CacheLike;
  providersUsed: Set<string>;
}

export class TTLCache {
  private store = new Map<string, CacheRecord<unknown>>();
  constructor(private defaultTtlMs = 1000 * 60 * 60 * 6) {}

  get<T>(key: string): T | undefined {
    const record = this.store.get(key) as CacheRecord<T> | undefined;
    if (!record) {
      return undefined;
    }
    if (record.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return record.value;
  }

  set<T>(key: string, value: T, options?: CacheOptions): void {
    const ttl = options?.ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }
}
