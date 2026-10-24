import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import type { FetchLike } from "./http.ts";
import { isMetadataIp, isPrivateIp, UnsafeUrlError } from "./netguard.ts";

type LookupAll = (hostname: string, options: LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * A DNS lookup for sockets that refuses forbidden addresses. The addresses it checks are the ones the socket connects
 * to, so a host name cannot pass `assertSafeUrl` with a public address and then be re-resolved to a private one
 * (DNS rebinding). IP literals never reach a lookup; `assertSafeUrl` checks those, and they cannot change.
 */
export function guardedLookup(options: { allowPrivate: boolean; lookup?: LookupAll }): LookupFunction {
  const lookupAll: LookupAll = options.lookup ?? ((host, opts, cb) => dnsLookup(host, opts, cb));
  return (hostname, lookupOptions, callback) => {
    lookupAll(hostname, { ...lookupOptions, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const refused = addresses.find((a) => isMetadataIp(a.address) || (!options.allowPrivate && isPrivateIp(a.address)));
      const first = addresses[0];
      if (refused || !first) {
        const reason = refused ? "resolves to an address that is not allowed" : "could not be resolved";
        return callback(Object.assign(new UnsafeUrlError(`The host name ${reason}.`), { code: "EVERITOMEGUARD" }), "", 0);
      }
      if (lookupOptions.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      else callback(null, first.address, first.family);
    });
  };
}

const agents = new Map<boolean, Agent>();

/**
 * A fetch whose connections only go to addresses the SSRF guard allows, checked at connect time. Use it for URLs
 * that came from users or outside services, after `assertSafeUrl`.
 */
export function guardedFetch(options: { allowPrivate: boolean }): FetchLike {
  let agent = agents.get(options.allowPrivate);
  if (!agent) agents.set(options.allowPrivate, (agent = new Agent({ connect: { lookup: guardedLookup(options) } })));
  const dispatcher = agent;
  return ((input: string | URL, init?: RequestInit) =>
    undiciFetch(input, { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher })) as unknown as FetchLike;
}
