import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

export interface GuardOptions {
  /** Allow loopback and private ranges (needed for a local Ollama). Cloud metadata stays blocked. */
  allowPrivate: boolean;
  resolve?: Resolver;
}

function ipv4ToInt(ip: string): number {
  const p = ip.split(".").map(Number);
  return (((p[0] ?? 0) << 24) | ((p[1] ?? 0) << 16) | ((p[2] ?? 0) << 8) | (p[3] ?? 0)) >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    s = `${s.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * Unwraps IPv6 addresses that carry an IPv4 one, so the IPv4 rules apply to them: IPv4-mapped (`::ffff:a.b.c.d`,
 * which the URL parser rewrites to `::ffff:102:304`), IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`, which
 * an IPv6-only network forwards to the IPv4 address) and 6to4 (`2002::/16`).
 */
function normaliseIp(ip: string): string {
  const lower = ip.toLowerCase();
  if (isIP(lower) !== 6) return lower;
  const g = ipv6Groups(lower);
  if (!g) return lower;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return v4(g[6]!, g[7]!);
  if (zero(0, 6) && (g[6]! > 0 || g[7]! > 1)) return v4(g[6]!, g[7]!);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6]!, g[7]!);
  if (g[0] === 0x2002) return v4(g[1]!, g[2]!);
  return lower;
}

export function isMetadataIp(ipRaw: string): boolean {
  const ip = normaliseIp(ipRaw);
  if (isIP(ip) === 4) return inCidr(ip, "169.254.0.0", 16) || ip === "100.100.100.200";
  return ip === "fd00:ec2::254" || ip.startsWith("fe80:");
}

export function isPrivateIp(ipRaw: string): boolean {
  const ip = normaliseIp(ipRaw);
  if (isIP(ip) === 4) {
    return (
      inCidr(ip, "10.0.0.0", 8) ||
      inCidr(ip, "172.16.0.0", 12) ||
      inCidr(ip, "192.168.0.0", 16) ||
      inCidr(ip, "127.0.0.0", 8) ||
      inCidr(ip, "0.0.0.0", 8) ||
      inCidr(ip, "100.64.0.0", 10) ||
      inCidr(ip, "169.254.0.0", 16)
    );
  }
  return ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:");
}

const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata", "instance-data"]);

/**
 * Validates a user-supplied URL before the server fetches it on the user's behalf.
 * Cloud metadata endpoints are always refused. Private ranges are refused unless
 * `allowPrivate` is set. Credentials in the URL are never accepted.
 */
export async function assertSafeUrl(input: string, options: GuardOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("The URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (METADATA_HOSTNAMES.has(host)) throw new UnsafeUrlError("That host is not allowed.");

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else if (host === "localhost" || host.endsWith(".localhost")) {
    addresses = ["127.0.0.1"];
  } else {
    const resolve = options.resolve ?? defaultResolver;
    try {
      addresses = await resolve(host);
    } catch {
      throw new UnsafeUrlError("The host name could not be resolved.");
    }
    if (addresses.length === 0) throw new UnsafeUrlError("The host name could not be resolved.");
  }

  for (const address of addresses) {
    if (isMetadataIp(address)) throw new UnsafeUrlError("That address is not allowed.");
    if (!options.allowPrivate && isPrivateIp(address)) {
      throw new UnsafeUrlError("Private and local addresses are disabled on this server.");
    }
  }
  return url;
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
}
