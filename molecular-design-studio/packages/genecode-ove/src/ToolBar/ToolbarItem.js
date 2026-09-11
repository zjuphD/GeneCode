import { connectToEditor } from "../withEditorProps";
// import download from 'in-browser-download'
import {
  AnchorButton,
  Intent
} from "@blueprintjs/core";
import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./style.css";
import { noop } from "lodash-es";

const TOOL_ACCESSIBLE_LABELS = {
  cutsiteTool: "Cut sites",
  featureTool: "Features",
  editTool: "Edit sequence",
  findTool: "Find",
  visibilityTool: "Visibility",
  undoTool: "Undo",
  redoTool: "Redo",
  importTool: "Import",
  downloadTool: "Download",
  alignmentTool: "Align",
  oligoTool: "Oligo",
  orfTool: "Open reading frames",
  partTool: "Parts",
  printTool: "Print",
  saveTool: "Save"
};

function toolAccessibleLabel(toolName) {
  const label = TOOL_ACCESSIBLE_LABELS[toolName];
  if (label) return label;
  const humanized = String(toolName || "")
    .replace(/Tool$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return humanized ? humanized.charAt(0).toUpperCase() + humanized.slice(1) : "Editor tool";
}

class ToolbarItem extends React.Component {
  containerRef = React.createRef();

  componentDidMount() {
    document.addEventListener("mousedown", this.handleDocumentMouseDown, true);
    document.addEventListener("keydown", this.handleDocumentKeyDown, true);
  }

  componentWillUnmount() {
    document.removeEventListener(
      "mousedown",
      this.handleDocumentMouseDown,
      true
    );
    document.removeEventListener("keydown", this.handleDocumentKeyDown, true);
  }

  handleDocumentMouseDown = event => {
    if (!this.props.isOpen) return;
    if (this.containerRef.current?.contains(event.target)) return;
    this.toggleDropdown({ forceClose: true });
  };

  handleDocumentKeyDown = event => {
    if (this.props.isOpen && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.toggleDropdown({ forceClose: true });
    }
  };

  toggleDropdown = ({ forceClose } = {}) => {
    const { toolName, isOpen } = this.props;

    this.props.openToolbarItemUpdate(isOpen || forceClose ? "" : toolName);
  };

  render() {
    const { overrides = {} } = this.props;
    const {
      isOpen,
      index,
      Icon,
      // dynamicIcon,
      onIconClick = noop,
      tooltip = "",
      tooltipToggled,
      dropdowntooltip = "",
      Dropdown,
      disabled,
      isHidden,
      renderIconAbove,
      noDropdownIcon,
      IconWrapper,
      editorName,
      popoverDisabled,
      IconWrapperProps,
      toolName,
      dropdownicon,
      tooltipDisabled,
      toggled = false,
      ...rest
    } = { ...this.props, ...overrides };
    if (!toolName) console.warn("toolName is required!");
    if (isHidden) return null;
    let tooltipToDisplay = tooltip;
    if (toggled && tooltipToggled) {
      tooltipToDisplay = tooltipToggled;
    }
    // const Dropdown = _DropDown && withEditorProps && withEditorProps(_DropDown);

    const buttonTarget = (
      <div
        className={
          `veToolbarItemOuter ve-tool-container-${toolName}` +
          (disabled ? " disabled " : "")
        }
      >
        {renderIconAbove && (
          <div>
            <div className="veToolbarItem">{Icon}</div>
          </div>
        )}

        {Icon && !renderIconAbove && (
          <AnchorButton
            intent={Intent.PRIMARY}
            onClick={
              onIconClick === "toggleDropdown"
                ? this.toggleDropdown
                : onIconClick
            }
            active={toggled}
            disabled={disabled}
            minimal
            aria-label={toolAccessibleLabel(toolName)}
            title={tooltipDisabled ? undefined : tooltipToDisplay}
            icon={
              React.isValidElement(Icon) ? (
                Icon
              ) : (
                <Icon toggleDropdown={this.toggleDropdown} />
              )
            }
          />
        )}
        {Dropdown && !noDropdownIcon ? (
          <div
            className={
              (isOpen ? " isOpen " : "") +
              (dropdownicon ? "" : " veToolbarDropdown")
            }
            role="button"
            tabIndex={0}
            title={tooltipDisabled ? undefined : dropdowntooltip}
            aria-label={`${toolAccessibleLabel(toolName)} options`}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            onClick={this.toggleDropdown}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.toggleDropdown();
              }
            }}
          >
            {dropdownicon ? (
              <div className="veToolbarIcon">
                <div>{dropdownicon}</div>
              </div>
            ) : isOpen ? (
              <ChevronUp
                data-test={toolName + "Dropdown"}
                size={13}
                aria-hidden="true"
              />
            ) : (
              <ChevronDown
                data-test={toolName + "Dropdown"}
                size={13}
                aria-hidden="true"
              />
            )}
          </div>
        ) : null}
      </div>
    );
    const content = (
      <div
        ref={n => {
          if (n) this.dropdownNode = n;
        }}
        style={{ padding: 10, minWidth: 250, maxWidth: 350 }}
        className="ve-toolbar-dropdown content"
      >
        {Dropdown && (
          <Dropdown
            {...rest}
            editorName={editorName}
            toggleDropdown={this.toggleDropdown}
          />
        )}
      </div>
    );
    const target = IconWrapper ? (
      <IconWrapper {...IconWrapperProps}>
        {({ getRootProps, getInputProps }) => (
          <div {...getRootProps()}>
            <input {...getInputProps()} />
            {buttonTarget}
          </div>
        )}
      </IconWrapper>
    ) : (
      buttonTarget
    );

    return (
      <div
        ref={this.containerRef}
        className="ve-toolbar-item-shell"
        style={{ display: "flex", alignItems: "center" }}
      >
        {index !== 0 && <div className="veToolbarSpacer" />}
        {target}
        {!!Dropdown && isOpen && !popoverDisabled && (
          <div className="ve-toolbar-dropdown-panel">{content}</div>
        )}
      </div>
    );
  }
}

export default connectToEditor(({ toolBar = {} }, { toolName }) => ({
  isOpen: toolBar.openItem === toolName
}))(ToolbarItem);
