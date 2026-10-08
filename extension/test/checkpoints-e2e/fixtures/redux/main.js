import { createStore } from 'redux';
function reducer(state = { count: 0, items: [] }, action) {
  switch (action.type) {
    case 'inc':
      return { ...state, count: state.count + 1 };
    case 'add':
      return { ...state, items: [...state.items, action.item] };
    default:
      return state;
  }
}
const store = createStore(
  reducer,
  window.__REDUX_DEVTOOLS_EXTENSION__ &&
    window.__REDUX_DEVTOOLS_EXTENSION__({ name: 'redux e2e' }),
);
// Minimal history router: renders on popstate like real routers do.
let renders = 0;
function render() {
  renders++;
  document.getElementById('route').textContent =
    location.pathname + location.search + location.hash;
  document.getElementById('state').textContent = JSON.stringify(
    store.getState(),
  );
  document.getElementById('renders').textContent = String(renders);
}
window.addEventListener('popstate', render);
window.addEventListener('hashchange', render);
store.subscribe(render);
window.reduxTest = { store, routerRenders: () => renders };
document.addEventListener('DOMContentLoaded', render);
