import { Menu } from "@blueprintjs/core";
import { SlidersHorizontal } from "lucide-react";
import React from "react";
import { createCommandMenu } from "@teselagen/ui";
import viewSubmenu from "../MenuBar/viewSubmenu";
import getCommands from "../commands";
import ToolbarItem from "./ToolbarItem";
import { connectToEditor } from "../withEditorProps";
import withEditorProps from "../withEditorProps";

export default connectToEditor(({ toolBar = {} }) => {
  return {
    isOpen: toolBar.openItem === "visibilityTool"
  };
})(({ toolbarItemProps, isOpen }) => {
  return (
    <ToolbarItem
      {...{
        Icon: <SlidersHorizontal aria-hidden="true" />,
        onIconClick: "toggleDropdown",
        Dropdown: VisibilityOptions,
        noDropdownIcon: true,
        toggled: isOpen,
        tooltip: isOpen ? "Hide Visibility Options" : "Show Visibility Options",
        ...toolbarItemProps
      }}
    />
  );
});

const VisibilityOptions = withEditorProps(function (props) {
  return (
    <Menu>
      {createCommandMenu(viewSubmenu, getCommands({ props }), {
        useTicks: true,
        omitIcons: true
      })}
    </Menu>
  );
});
