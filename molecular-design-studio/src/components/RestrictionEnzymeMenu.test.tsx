import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RestrictionEnzymeMenu } from "./RestrictionEnzymeMenu";

describe("RestrictionEnzymeMenu", () => {
  it("keeps enzyme choices selectable inside the compact menu", () => {
    const onChange = vi.fn();
    render(<RestrictionEnzymeMenu value="cloning" onChange={onChange} onManage={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "限制酶分组" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "使用酶分组" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Golden Gate 酶/ }));
    expect(onChange).toHaveBeenCalledWith("golden-gate");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes only this menu and returns focus to its trigger", () => {
    render(<RestrictionEnzymeMenu value="cloning" onChange={vi.fn()} onManage={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "限制酶分组" });
    fireEvent.click(trigger);
    const workspaceEscape = vi.fn();
    window.addEventListener("keydown", workspaceEscape);
    try {
      fireEvent.keyDown(screen.getByRole("menuitem", { name: "使用酶分组" }), { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(workspaceEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", workspaceEscape);
    }
  });

  it("preserves the enzyme management entry point", () => {
    const onManage = vi.fn();
    render(<RestrictionEnzymeMenu value="cloning" onChange={vi.fn()} onManage={onManage} />);
    fireEvent.click(screen.getByRole("button", { name: "限制酶分组" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /管理酶分组/ }));
    expect(onManage).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
