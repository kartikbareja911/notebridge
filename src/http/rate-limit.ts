export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(key: string): RateLimitDecision;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Rate limit must be a positive integer");
    }
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
      throw new Error("Rate limit window must be a positive integer");
    }
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    const existing = this.buckets.get(key);
    const bucket =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + this.windowMs,
          };

    bucket.count += 1;
    this.buckets.set(key, bucket);
    this.prune(now);

    const remaining = Math.max(this.limit - bucket.count, 0);
    return {
      allowed: bucket.count <= this.limit,
      limit: this.limit,
      remaining,
      retryAfterSeconds: Math.max(Math.ceil((bucket.resetAt - now) / 1_000), 1),
      resetAt: bucket.resetAt,
    };
  }

  private prune(now: number): void {
    if (this.buckets.size < 10_000) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
