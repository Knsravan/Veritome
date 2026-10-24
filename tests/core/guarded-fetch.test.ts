import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { guardedFetch, guardedLookup } from "../../src/core/infra/guarded-fetch.ts";
import { UnsafeUrlError } from "../../src/core/infra/netguard.ts";
import { createLlmClient } from "../../src/core/llm/client.ts";

const fakeDns = (addresses: string[]) => (_host: string, _opts: unknown, cb: (err: null, a: Array<{ address: string; family: number }>) => void) =>
  cb(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

function look(lookup: ReturnType<typeof guardedLookup>, all = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup("example.org", { all } as never, (err: Error | null, address: unknown) => (err ? reject(err) : resolve(address)));
  });
}

test("guardedLookup refuses what a host name resolves to at connect time", async () => {
  await assert.rejects(look(guardedLookup({ allowPrivate: false, lookup: fakeDns(["93.184.216.34", "10.0.0.7"]) })), UnsafeUrlError);
  await assert.rejects(look(guardedLookup({ allowPrivate: true, lookup: fakeDns(["169.254.169.254"]) })), UnsafeUrlError);
  await assert.rejects(look(guardedLookup({ allowPrivate: false, lookup: fakeDns(["64:ff9b::a9fe:a9fe"]) })), UnsafeUrlError);
  await assert.rejects(look(guardedLookup({ allowPrivate: false, lookup: fakeDns([]) })), UnsafeUrlError);
  assert.equal(await look(guardedLookup({ allowPrivate: false, lookup: fakeDns(["93.184.216.34"]) })), "93.184.216.34");
  assert.deepEqual(await look(guardedLookup({ allowPrivate: true, lookup: fakeDns(["10.0.0.7"]) }), true), [{ address: "10.0.0.7", family: 4 }]);
});

test("guardedFetch only connects to allowed addresses", async () => {
  const server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://localhost:${(server.address() as AddressInfo).port}/`;
  try {
    await assert.rejects(guardedFetch({ allowPrivate: false })(url), (err: Error) => err.cause instanceof UnsafeUrlError);
    const res = await guardedFetch({ allowPrivate: true })(url);
    assert.equal(await res.text(), "ok");
  } finally {
    server.close();
  }
});

test("llm client reports a refused address as such", async () => {
  const refused = (async () => {
    throw new TypeError("fetch failed", { cause: new UnsafeUrlError("The host name resolves to an address that is not allowed.") });
  }) as typeof fetch;
  const llm = createLlmClient({ baseUrl: "https://llm.example.org/v1", model: "m" }, { fetch: refused });
  await assert.rejects(llm.chat({ system: "s", user: "u" }), UnsafeUrlError);
});
