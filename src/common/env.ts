const durationPattern = /^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)$/u;

export function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function envInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

export function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`${name} must be a boolean`);
  }
}

export function envDurationMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallbackMs;
  const match = durationPattern.exec(raw.trim());
  if (match === null) throw new Error(`${name} must be a duration such as 250ms or 5s`);
  const value = Number(match[1]);
  const multiplier: Record<string, number> = {
    ns: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000
  };
  const unit = match[2];
  if (unit === undefined) throw new Error(`${name} must include a duration unit`);
  const result = value * (multiplier[unit] ?? Number.NaN);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${name} must be non-negative`);
  return result;
}

export function envList(name: string, fallback: readonly string[]): readonly string[] {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return values;
}
