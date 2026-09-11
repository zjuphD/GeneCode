import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Settings2, Scissors } from "lucide-react";

export type EnzymeMode =
  | "cloning"
  | "golden-gate"
  | "single"
  | "double"
  | "single-double"
  | "type2s"
  | "all"
  | "hidden";

interface EnzymeModeOption {
  value: EnzymeMode;
  label: string;
  detail?: string;
}

interface RestrictionEnzymeMenuProps {
  value: EnzymeMode;
  onChange: (value: EnzymeMode) => void;
  onManage: () => void;
}

const modeOptions: EnzymeModeOption[] = [
  { value: "all", label: "全部酶", detail: "显示所有可用位点" },
  { value: "cloning", label: "常用克隆酶", detail: "常用克隆酶" },
  { value: "golden-gate", label: "Golden Gate 酶", detail: "常见 Type IIS 组装酶" },
  { value: "type2s", label: "Type IIS 酶", detail: "所有 Type IIS 识别酶" },
  { value: "single", label: "单切酶", detail: "在此序列中恰好切一次" },
  { value: "single-double", label: "单切 + 双切酶", detail: "在此序列中切一至两次" },
  { value: "double", label: "双切酶", detail: "在此序列中恰好切两次" },
  { value: "hidden", label: "隐藏所有位点", detail: "保持酶切位点图层隐藏" },
];

const modeLabel = new Map(modeOptions.map((option) => [option.value, option.label]));

export function RestrictionEnzymeMenu({
  value,
  onChange,
  onManage,
}: RestrictionEnzymeMenuProps) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"use" | "visibility" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setSubmenu(null);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    setSubmenu(null);
  };

  const selectMode = (nextMode: EnzymeMode) => {
    onChange(nextMode);
    closeMenu();
  };

  const renderModeItem = (option: EnzymeModeOption) => (
    <button
      type="button"
      key={option.value}
      className="ove-enzyme-menu__item"
      onClick={() => selectMode(option.value)}
      title={option.detail}
      role="menuitemradio"
      aria-checked={value === option.value}
    >
      <span className="ove-enzyme-menu__check" aria-hidden="true">
        {value === option.value && <Check />}
      </span>
      <span className="ove-enzyme-menu__item-copy">
        <span>{option.label}</span>
        {option.detail && <small>{option.detail}</small>}
      </span>
    </button>
  );

  return (
    <div className="ove-enzyme-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="ove-enzyme-menu__trigger"
        onClick={() => {
          setOpen((current) => !current);
          setSubmenu(null);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="限制酶分组"
        title="选择限制酶分组"
      >
        <Scissors aria-hidden="true" />
        <span className="ove-enzyme-menu__trigger-label">酶</span>
        <span className="ove-enzyme-menu__trigger-value">{modeLabel.get(value)}</span>
        <ChevronRight className="ove-enzyme-menu__trigger-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="ove-enzyme-menu__popover" role="menu">
          <button
            type="button"
            className={`ove-enzyme-menu__item ove-enzyme-menu__item--parent ${submenu === "use" ? "is-open" : ""}`}
            onMouseEnter={() => setSubmenu("use")}
            onFocus={() => setSubmenu("use")}
            onClick={() => setSubmenu("use")}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === "use"}
          >
            <span className="ove-enzyme-menu__check" aria-hidden="true" />
            <span className="ove-enzyme-menu__item-copy"><span>使用酶分组</span></span>
            <ChevronRight aria-hidden="true" />
          </button>
          {submenu === "use" && (
            <div className="ove-enzyme-menu__submenu" role="menu">
              {modeOptions
                .filter((option) => option.value !== "hidden")
                .map(renderModeItem)}
            </div>
          )}

          <button
            type="button"
            className={`ove-enzyme-menu__item ove-enzyme-menu__item--parent ${submenu === "visibility" ? "is-open" : ""}`}
            onMouseEnter={() => setSubmenu("visibility")}
            onFocus={() => setSubmenu("visibility")}
            onClick={() => setSubmenu("visibility")}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === "visibility"}
          >
            <span className="ove-enzyme-menu__check" aria-hidden="true" />
            <span className="ove-enzyme-menu__item-copy"><span>显示或隐藏酶</span></span>
            <ChevronRight aria-hidden="true" />
          </button>
          {submenu === "visibility" && (
            <div className="ove-enzyme-menu__submenu" role="menu">
              {renderModeItem({ value: "all", label: "显示所有位点", detail: "使用所有可用酶" })}
              {renderModeItem({ value: "hidden", label: "隐藏所有位点", detail: "关闭酶切位点图层" })}
              <button
                type="button"
                className="ove-enzyme-menu__item"
                onClick={() => {
                  onManage();
                  closeMenu();
                }}
                role="menuitem"
              >
                <span className="ove-enzyme-menu__check" aria-hidden="true"><Settings2 /></span>
                <span className="ove-enzyme-menu__item-copy"><span>管理酶…</span></span>
              </button>
            </div>
          )}

          <div className="ove-enzyme-menu__divider" />
          <button
            type="button"
            className="ove-enzyme-menu__item"
            onClick={() => {
              onManage();
              closeMenu();
            }}
            role="menuitem"
          >
            <span className="ove-enzyme-menu__check" aria-hidden="true"><Settings2 /></span>
            <span className="ove-enzyme-menu__item-copy">
              <span>管理酶分组…</span>
              <small>创建、重命名、隐藏或复制酶分组</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
