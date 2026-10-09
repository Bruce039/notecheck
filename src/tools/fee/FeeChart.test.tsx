import { fireEvent, render, screen } from "@testing-library/react";
import { FeeChart } from "./FeeChart";
import { MAX_TX_CYCLES, computeFee } from "./fee";

describe("FeeChart", () => {
  it("summarizes the current point, its step and the next threshold", () => {
    const { container } = render(<FeeChart fee={computeFee(100_000n, 7n)} />);
    const label = screen.getByRole("img").getAttribute("aria-label")!;
    expect(label).toMatch(/100,000 cycles cost 119 \(17 × base fee 7\)/);
    expect(label).toMatch(/rises to 126 at 131,072 cycles/);
    expect(container.querySelector(".fc-legend")).toHaveTextContent("same fee for 65,536–131,071");
    expect(container.querySelector(".fc-legend")).toHaveTextContent("+31,072 cycles → 126");
    expect(container.querySelector(".fc-next")).toHaveTextContent("next 217");
    expect(container.querySelectorAll(".fc-xtick")).toHaveLength(7);
  });

  it("has no next marker at the cycle limit", () => {
    const { container } = render(<FeeChart fee={computeFee(MAX_TX_CYCLES, 7n)} />);
    expect(container.querySelector(".fc-next")).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/last step/);
  });

  it("renders a zero base fee without NaN geometry", () => {
    const { container } = render(<FeeChart fee={computeFee(5n, 0n)} />);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("shows cycles and fee under the pointer", () => {
    const { container } = render(<FeeChart fee={computeFee(100_000n, 7n)} />);
    const hit = container.querySelector(".fc-hit")!;
    // jsdom has no layout: the svg sits at 0,0, so client x equals plot x.
    const x0 = Number(hit.getAttribute("x")), w = Number(hit.getAttribute("width"));
    fireEvent.pointerMove(hit, { clientX: x0 + (w * 10.5) / 29, clientY: 100 });
    expect(container.querySelector(".fc-hover")).toHaveTextContent("1,448 cycles → 77 (11×)");
    fireEvent.pointerLeave(hit);
    expect(container.querySelector(".fc-hover")).toBeNull();
  });
});
