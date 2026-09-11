import React from "react";
import { Search } from "lucide-react";
import FindBar from "../FindBar";
import ToolbarItem from "./ToolbarItem";
import { connectToEditor } from "../withEditorProps";

export default connectToEditor(({ findTool = {} }) => {
  return {
    isOpen: findTool.isOpen
  };
})(({
  toolbarItemProps,
  editorName,
  toggleFindTool,
  isOpen,
  additionalEnzymes
}) => {
  return (
    <ToolbarItem
      {...{
        Icon: !isOpen ? (
          <Search data-test="ve-find-tool-toggle" aria-hidden="true" />
        ) : (
          <FindBar
            editorName={editorName}
            additionalEnzymes={additionalEnzymes}
          />
        ),
        renderIconAbove: isOpen,
        onIconClick: toggleFindTool,
        tooltip: isOpen ? "关闭查找 (Cmd/Ctrl+F)" : "查找序列 (Cmd/Ctrl+F)",
        ...toolbarItemProps
      }}
    />
  );
});
