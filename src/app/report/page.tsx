import { redirect } from "next/navigation";

/** The full paper check now lives in the plagiarism tool; old links keep working. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  redirect(sp.sample === "1" ? "/plagiarism?sample=1" : "/plagiarism");
}
