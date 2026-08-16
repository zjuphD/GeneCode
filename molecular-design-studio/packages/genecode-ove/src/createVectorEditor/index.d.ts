type ReduxStore = {
    dispatch: (...args: any[]) => any;
    getState: () => any;
};

type StoreFactory = (options: {
    editorName: string;
    storeKey: string;
}) => ReduxStore;

export default function createVectorEditor(_node: any, options?: {
    editorName?: string;
    store?: ReduxStore;
    storeFactory?: StoreFactory;
    createStore?: StoreFactory;
    storeKey?: string;
    strictMode?: boolean;
    [key: string]: any;
}): {
    renderResponse: void;
    close(): void;
    updateEditor(values: any): void;
    addAlignment(values: any): void;
    getState(): any;
    getStore(): ReduxStore;
};

export function createVersionHistoryView(node: any, options?: {
    editorName?: string;
    storeKey?: string;
    store?: ReduxStore;
    [key: string]: any;
}): {
    renderResponse: void;
    close(): void;
    updateEditor(values: any): void;
    getState(): any;
    getStore(): ReduxStore;
};

export function createAlignmentView(node: any, props?: {
    storeKey?: string;
    store?: ReduxStore;
    [key: string]: any;
}): {
    renderResponse: void;
    close(): void;
    updateAlignment(values: any): void;
    getState(): any;
    getStore(): ReduxStore;
};
