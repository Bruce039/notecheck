import { render, screen } from "@testing-library/react";
import { AvalancheView } from "./AvalancheView";
import { encodeString, hashFelts } from "./hash";

describe("AvalancheView", () => {
  it("compares [1, 2, 3] with [1, 2, 4]", () => {
    const base = hashFelts([1n, 2n, 3n]);
    const { container } = render(
      <AvalancheView mode="felts" text="[1, 2, 3]" input={base.input} digest={base.poseidon2.hex} />,
    );
    expect(container.querySelector(".av-change")).toHaveTextContent("felt 2: 3 → 4");
    expect(container).toHaveTextContent("62 of 64 hex digits changed ~97%");
    expect(container).toHaveTextContent("131 of 256 bits changed ~51%");
    expect(container.querySelectorAll(".av-cell")).toHaveLength(256);
    expect(container.querySelectorAll(".av-cell.on")).toHaveLength(131);
    expect(container.querySelectorAll(".av-new")).toHaveLength(62);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringMatching(/131 of 256/));
    // The changed digest is the real Poseidon2 hash of the tweaked input.
    const tweaked = hashFelts([1n, 2n, 4n]).poseidon2.hex.slice(2);
    const shown = container.querySelectorAll(".av-hex")[1].textContent;
    expect(shown).toBe(tweaked);
  });

  it("changes one character in string mode", () => {
    const base = hashFelts(encodeString("hello"));
    const { container } = render(
      <AvalancheView mode="string" text="hello" input={base.input} digest={base.poseidon2.hex} />,
    );
    expect(container.querySelector(".av-change")).toHaveTextContent("o U+006F → p U+0070");
    expect(container.querySelector(".av-change")).toHaveTextContent("“hellp”");
    const shown = container.querySelectorAll(".av-hex")[1].textContent;
    expect(shown).toBe(hashFelts(encodeString("hellp")).poseidon2.hex.slice(2));
  });

  it("appends a felt to the empty list", () => {
    const base = hashFelts([]);
    const { container } = render(<AvalancheView mode="felts" text="[]" input={[]} digest={base.poseidon2.hex} />);
    expect(container.querySelector(".av-change")).toHaveTextContent("Append felt 0");
    expect(container.querySelectorAll(".av-hex")[1].textContent).toBe(hashFelts([0n]).poseidon2.hex.slice(2));
  });
});
