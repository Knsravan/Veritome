import Link from "next/link";
import { TOOLS } from "@/lib/tools";
import { LogoMark, ArrowRightIcon } from "./icons";

/** The page of a tool that is not open yet. */
export function ComingSoon({ href }: { href: string }) {
  const tool = TOOLS.find((t) => t.href === href);
  const ready = TOOLS.filter((t) => !t.soon);
  return (
    <section
      aria-labelledby="soon-h"
      className="card animate-fade-up relative mx-auto max-w-2xl overflow-hidden p-8 text-center sm:p-12"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-action/10 blur-3xl"
      />
      <div className="relative">
        <span className="inline-flex">
          <LogoMark size={56} mode="intro" />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-wide text-action uppercase">
          Coming soon
        </p>
        <h1
          id="soon-h"
          className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {tool?.name ?? "This tool"} is on its way
        </h1>
        {tool && (
          <p className="mx-auto mt-3 max-w-lg text-lg text-ink-soft">
            {tool.does}
          </p>
        )}
        <p className="mx-auto mt-4 max-w-lg text-ink-soft">
          We are finishing it to the same standard as our ready tools.
          Meanwhile, you can use:
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-3">
          {ready.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                className="inline-flex items-center gap-2 rounded-full bg-action px-5 py-2.5 font-semibold text-action-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.22),var(--neu-sm)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 active:shadow-[inset_2px_2px_6px_rgb(0_0_0/0.25)]"
              >
                {t.name} <ArrowRightIcon size={16} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
