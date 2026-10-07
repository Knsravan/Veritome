"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ElementType, type HTMLAttributes, type ReactNode } from "react";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fades its children up when they scroll into view. Content that is already on screen when the page loads is
 * never hidden, and everything stays visible without JavaScript or with reduced motion.
 */
export function Reveal({
  children,
  as: Tag = "div",
  index = 0,
  style,
  ...rest
}: { children: ReactNode; as?: ElementType; index?: number } & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  useIso(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    el.classList.add("reveal-pending");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        el.classList.add("reveal-shown");
        el.classList.remove("reveal-pending");
        io.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} {...rest} style={{ ...style, ["--i" as string]: index }}>
      {children}
    </Tag>
  );
}

/** Counts up to `value` once, when it first appears. Screen readers get the final value straight away. */
export function CountUp({ value, decimals = 0, duration = 900, suffix = "" }: { value: number; decimals?: number; duration?: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);
  useIso(() => {
    if (prefersReducedMotion() || !Number.isFinite(value) || value === 0) {
      setShown(value);
      return;
    }
    setShown(0);
    let raf = 0;
    let start = 0;
    const run = () => {
      const tick = (t: number) => {
        if (!start) start = t;
        const k = Math.min(1, (t - start) / duration);
        setShown(value * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const el = ref.current;
    if (el && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(([e]) => {
        if (e?.isIntersecting) {
          io.disconnect();
          run();
        }
      });
      io.observe(el);
      return () => {
        io.disconnect();
        cancelAnimationFrame(raf);
      };
    }
    run();
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  const final = `${value.toFixed(decimals)}${suffix}`;
  return (
    <span ref={ref} className="tabular-nums">
      <span aria-hidden>
        {shown.toFixed(decimals)}
        {suffix}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
