import { render, screen } from "@testing-library/react";
import { EXAMPLE_RECEIPT_PATH } from "@/receipt/example";
import { Hero } from "./Hero";

function mockMatchMedia(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion: reduce"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("Hero", () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it("renders the headline, both calls to action and the three steps", () => {
    render(<Hero docsHref="/?tool=docs" />);
    expect(screen.getByRole("heading", { level: 2, name: /Private payments\. Receipts you can share and check/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See an example receipt/ })).toHaveAttribute("href", EXAMPLE_RECEIPT_PATH);
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/?tool=docs");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/Only this payment is visible/)).toBeInTheDocument();
  });

  it("keeps the illustration out of the accessibility tree but describes it in text", () => {
    const { container } = render(<Hero docsHref="/docs" />);
    expect(container.querySelector(".nch-svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/a paper receipt prints out/i)).toBeInTheDocument();
  });

  it("does not render a wallet button", () => {
    render(<Hero docsHref="/docs" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("plays the animation by default", () => {
    mockMatchMedia(false);
    const { container } = render(<Hero docsHref="/docs" />);
    const root = container.querySelector(".nch")!;
    expect(root).not.toHaveClass("nch-still");
    expect(root).toHaveAttribute("data-motion", "full");
  });

  it("switches to the still, finished state when reduced motion is requested", () => {
    mockMatchMedia(true);
    const { container } = render(<Hero docsHref="/docs" />);
    const root = container.querySelector(".nch")!;
    expect(root).toHaveClass("nch-still");
    expect(root).toHaveAttribute("data-motion", "reduced");
  });

  it("gives each instance its own SVG ids", () => {
    const { container } = render(<><Hero docsHref="/a" /><Hero docsHref="/b" /></>);
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
