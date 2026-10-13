import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GlassBar } from "@/components/GlassBar";
import { UI_SCRIPT, glassKept, keepGlass, showGlass } from "@/lib/ui-style";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.ui;
  path.current = "/";
});

const ui = () => document.documentElement.dataset.ui;

describe("glass preview switches", () => {
  test("showing glass marks the page without remembering it", () => {
    showGlass(true);
    expect(ui()).toBe("glass");
    expect(glassKept()).toBe(false);
    showGlass(false);
    expect(ui()).toBeUndefined();
  });

  test("keeping glass on remembers it, and the head script applies it before paint", () => {
    keepGlass(true);
    expect(ui()).toBe("glass");
    expect(glassKept()).toBe(true);

    delete document.documentElement.dataset.ui;
    new Function(UI_SCRIPT)();
    expect(ui()).toBe("glass");

    keepGlass(false);
    expect(ui()).toBeUndefined();
    new Function(UI_SCRIPT)();
    expect(ui()).toBeUndefined();
  });

  test("the bar shows on other pages only while glass is kept on, and turns it off", () => {
    render(<GlassBar />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => keepGlass(true));
    expect(screen.getByRole("status")).toHaveTextContent("Glass preview is on");
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(ui()).toBeUndefined();
    expect(glassKept()).toBe(false);
  });

  test("the bar stays out of the way on the preview page itself", () => {
    keepGlass(true);
    path.current = "/preview/glass";
    render(<GlassBar />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
