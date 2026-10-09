// Docs tab: every section renders, in-page links resolve, and links into the app use real routes.
import { render, screen, within } from "@testing-library/react";
import { EXAMPLE_RECEIPT_PATH } from "@/receipt/example";
import { DocsPage } from "./DocsPage";

// Tab ids App.tsx accepts in `?tool=`.
const TOOL_IDS = ["pay", "receipt", "address", "felt", "tag", "hash", "fee", "allowlist", "docs"];

const SECTION_TITLES = [
  "What is NoteCheck",
  "Pay with a receipt",
  "Check a receipt",
  "Receive the payment in your wallet",
  "What a receipt proves, and what it doesn't",
  "Developer tools",
  "Receipts from the Miden CLI",
  "FAQ",
  "Glossary",
];

describe("DocsPage", () => {
  it("renders every section heading", () => {
    render(<DocsPage />);
    for (const t of SECTION_TITLES) {
      expect(screen.getByRole("heading", { level: 2, name: new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toBeInTheDocument();
    }
  });

  it("points every in-page link at an element that exists", () => {
    const { container } = render(<DocsPage />);
    const hashLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    expect(hashLinks.length).toBeGreaterThan(SECTION_TITLES.length);
    for (const a of hashLinks) {
      const id = a.getAttribute("href")!.slice(1);
      expect(document.getElementById(id), `#${id}`).not.toBeNull();
    }
  });

  it("lists every section in the table of contents, in order", () => {
    render(<DocsPage />);
    const tocs = screen.getAllByRole("navigation", { name: "On this page", hidden: true });
    expect(tocs.length).toBeGreaterThan(0);
    for (const nav of tocs) {
      const names = within(nav).getAllByRole("link", { hidden: true }).map((a) => a.textContent);
      expect(names).toEqual(SECTION_TITLES);
    }
  });

  it("links to the example receipt", () => {
    render(<DocsPage />);
    const links = screen.getAllByRole("link", { name: "See an example receipt" });
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a).toHaveAttribute("href", EXAMPLE_RECEIPT_PATH);
  });

  it("uses only valid ?tool= ids", () => {
    const { container } = render(<DocsPage />);
    const toolLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[href*="tool="]')];
    const ids = toolLinks.map((a) => new URL(a.getAttribute("href")!, "https://example.test").searchParams.get("tool"));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(TOOL_IDS).toContain(id);
    // Every developer tool gets its own link.
    for (const id of ["address", "felt", "tag", "hash", "fee", "allowlist"]) expect(ids).toContain(id);
    expect(screen.getByRole("link", { name: "Go to Pay" })).toHaveAttribute("href", "/?tool=pay");
  });

  it("shows content without IntersectionObserver (no fade-in hiding)", () => {
    const { container } = render(<DocsPage />);
    expect(container.querySelector(".docs")).not.toHaveAttribute("data-anim");
    for (const s of container.querySelectorAll(".docs-section")) expect(s).toHaveClass("docs-in");
  });
});
