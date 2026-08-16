import React, { ComponentType } from "react";

export type PanelComponent = ComponentType<any> | {
    comp: ComponentType<any>;
    panelSpecificProps?: string[];
    panelSpecificPropsToSpread?: string[];
};

export type PanelComponents = Record<string, PanelComponent>;

export const defaultPanelMap: PanelComponents;

export class Editor extends React.Component<any, any> {}

declare const connectedEditor: ComponentType<any>;
export default connectedEditor;
