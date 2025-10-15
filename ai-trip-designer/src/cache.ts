import { CacheLike, CacheOptions } from './types';

interface CacheRecord<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache implements CacheLike {
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

export const defaultCache = new TTLCache();
