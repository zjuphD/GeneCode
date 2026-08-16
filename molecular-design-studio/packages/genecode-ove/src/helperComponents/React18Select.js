import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import "./React18Select.css";

const optionValue = option =>
  option && typeof option === "object" ? option.value : option;

const optionText = option => {
  if (option == null) return "";
  if (typeof option !== "object") return String(option);
  if (typeof option.label === "string") return option.label;
  if (typeof option.name === "string") return option.name;
  return String(option.value ?? "");
};

const normalizeSelected = (value, options) => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .map(item =>
      item && typeof item === "object"
        ? item
        : options.find(option => optionValue(option) === item)
    )
    .filter(Boolean);
};

/**
 * Small React 18-safe replacement for the TgSelect surfaces OVE actually uses.
 * The legacy component is coupled to Blueprint v3 MultiSelect/ResizeSensor,
 * which calls findDOMNode. This keeps the important value/onChange contract
 * without a hidden legacy React root or deprecated DOM lookup.
 */
export default function React18Select({
  options = [],
  value,
  onChange = () => {},
  onInputChange = () => {},
  optionRenderer,
  noResultsText = "No Results...",
  multi = false,
  disabled = false,
  placeholder = "Select...",
  additionalRightEl,
  wrapperStyle,
  className = "",
  autoOpen = false,
  autoFocus = false,
  closeOnSelect = false,
  allowCreate = false,
  creatable = false,
  ...rendererProps
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useId();
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState("");
  const selected = useMemo(
    () => normalizeSelected(value, options),
    [value, options]
  );
  const selectedValues = useMemo(
    () => new Set(selected.map(optionValue)),
    [selected]
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter(option => {
      if (multi && selectedValues.has(optionValue(option))) return false;
      return !needle || optionText(option).toLowerCase().includes(needle);
    });
  }, [multi, options, query, selectedValues]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [open]);

  const updateQuery = next => {
    setQuery(next);
    onInputChange(next);
  };

  const choose = (option, event) => {
    if (option?.disabled) return;
    if (multi) {
      onChange([...selected, option], event);
      if (closeOnSelect || option?.closeOnSelect) setOpen(false);
    } else {
      onChange(option, event);
      setOpen(false);
    }
    updateQuery("");
    inputRef.current?.focus();
  };

  const remove = (option, event) => {
    event.stopPropagation();
    const next = selected.filter(
      item => optionValue(item) !== optionValue(option)
    );
    onChange(multi ? next : null, event);
  };

  const createOption = event => {
    const label = query.trim();
    if (!label) return;
    choose({ label, value: label, userCreated: true }, event);
  };

  const renderLabel = option =>
    option && typeof option === "object"
      ? option.label ?? option.name ?? option.value
      : option;

  return (
    <div
      ref={rootRef}
      className={`genecode-react18-select ${className}`.trim()}
      style={wrapperStyle}
    >
      <div
        className={`genecode-react18-select__control${disabled ? " is-disabled" : ""}`}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <div className="genecode-react18-select__values">
          {selected.map(option => (
            <span
              className="genecode-react18-select__tag"
              key={String(optionValue(option))}
            >
              <span>{renderLabel(option)}</span>
              {multi && !option.disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${optionText(option)}`}
                  onClick={event => remove(option, event)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            autoComplete="off"
            autoFocus={autoFocus}
            disabled={disabled}
            value={query}
            placeholder={selected.length ? "" : placeholder}
            onFocus={() => !disabled && setOpen(true)}
            onChange={event => {
              updateQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={event => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setOpen(false);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (filtered[0]) choose(filtered[0], event);
                else if (allowCreate || creatable) createOption(event);
              }
            }}
          />
        </div>
        {additionalRightEl}
        <button
          type="button"
          className="genecode-react18-select__toggle"
          aria-label={open ? "Close options" : "Open options"}
          disabled={disabled}
          onClick={event => {
            event.stopPropagation();
            setOpen(current => !current);
          }}
        >
          {open ? "▴" : "▾"}
        </button>
      </div>

      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable={multi || undefined}
          className="genecode-react18-select__menu"
        >
          {filtered.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={selectedValues.has(optionValue(option))}
              disabled={option?.disabled}
              className="genecode-react18-select__option"
              key={`${String(optionValue(option))}:${index}`}
              onClick={event => choose(option, event)}
            >
              {optionRenderer
                ? optionRenderer(option, {
                    ...rendererProps,
                    options,
                    value,
                    multi
                  })
                : renderLabel(option)}
            </button>
          ))}
          {!filtered.length && (allowCreate || creatable) && query.trim() && (
            <button
              type="button"
              role="option"
              aria-selected="false"
              className="genecode-react18-select__option"
              onClick={createOption}
            >
              Create “{query.trim()}”
            </button>
          )}
          {!filtered.length && !(allowCreate || creatable) && (
            <div className="genecode-react18-select__empty">{noResultsText}</div>
          )}
        </div>
      )}
    </div>
  );
}
