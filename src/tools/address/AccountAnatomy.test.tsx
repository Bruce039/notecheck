import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountAnatomy } from "./AccountAnatomy";

// 0x790a5c308e26618159a26f324f22f3: private, ID version 1, no asset callbacks.
const props = {
  prefix: 0x790a5c308e266181n, suffix: 0x59a26f324f22f300n,
  version: 1, visibility: "private" as const, assetCallbacks: false, tagHex: "0x79080000",
};
const popcount = (v: bigint) => v.toString(2).split("").filter((c) => c === "1").length;

describe("AccountAnatomy", () => {
  it("draws every bit of both felts with the decoded values", () => {
    const { container } = render(<AccountAnatomy {...props} />);
    expect(container.querySelectorAll(".anat-bit")).toHaveLength(128);
    expect(container.querySelectorAll(".anat-bit.one")).toHaveLength(popcount(props.prefix) + popcount(props.suffix));
    expect(container.querySelectorAll(".anat-bit.seg-dropped")).toHaveLength(8);
    expect(container.querySelectorAll(".anat-bit.seg-version")).toHaveLength(4);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/callbacks off, private, version 1/);
    expect(screen.getByText("note tag · 14 bits")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Note tag/ })).toHaveTextContent("0x79080000");
    // Zoomed low byte 0x81 = 1000 0001.
    expect(Array.from(container.querySelectorAll(".anat-zbit"), (e) => e.textContent).join("")).toBe("10000001");
  });

  it("highlights a segment and explains it on focus, and clears on blur", async () => {
    const { container } = render(<AccountAnatomy {...props} />);
    const chip = screen.getByRole("button", { name: /Storage mode/ });
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /Note tag/ })).toHaveFocus();
    act(() => chip.focus());
    expect(chip).toHaveClass("on");
    expect(chip).toHaveAttribute("aria-describedby", container.querySelector(".anat-info")!.id);
    expect(container.querySelector(".anat-info")).toHaveTextContent(/only a commitment/);
    const lit = container.querySelectorAll(".anat-bit:not(.dim)");
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveClass("seg-type");
    act(() => chip.blur());
    expect(container.querySelectorAll(".anat-bit.dim")).toHaveLength(0);
    expect(container.querySelector(".anat-info")).toHaveTextContent(/Select a segment/);
  });

  it("lights the 14 tag bits when hovering the bracket", () => {
    const { container } = render(<AccountAnatomy {...props} />);
    fireEvent.mouseEnter(container.querySelector(".anat-bracket")!);
    const lit = Array.from(container.querySelectorAll(".anat-bit:not(.dim)"));
    expect(lit).toHaveLength(14);
    expect(container.querySelector(".anat-info")).toHaveTextContent(/top 14 bits/);
  });
});
