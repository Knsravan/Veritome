import { readConfig } from "@/server/config";
import { publicStatus } from "@/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await publicStatus(readConfig()), { headers: { "cache-control": "no-store" } });
}
