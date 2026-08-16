//optionally connect to the redux store
import { createStore, combineReducers, applyMiddleware, compose } from "redux";
import VectorEditor, { vectorEditorMiddleware } from "../redux";
import thunk from "redux-thunk";
import { reducer as form } from "redux-form";

const makeStore = ({ name = "createVectorEditor" } = {}) => {
  const devtoolsCompose =
    typeof window !== "undefined" &&
    window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__;
  const composeEnhancer =
    (devtoolsCompose &&
      devtoolsCompose({
        name,
        latency: 1000,
        // serialize: {
        //   replacer: (key, value) => {
        //   }
        // },
        actionsDenylist: []
      })) ||
    compose;

  const store = createStore(
    combineReducers({
      form,
      VectorEditor: VectorEditor()
    }),
    undefined,
    composeEnhancer(
      applyMiddleware(thunk, vectorEditorMiddleware) //your store should be redux-thunk connected for the VectorEditor component to work
    )
  );
  return store;
};

export { makeStore };
export default makeStore;
