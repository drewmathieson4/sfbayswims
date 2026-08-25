// The swimmer / streaks / UI switches (keys a s u, ?swimmer=0 ?streaks=0 ?ui=0, ?static=1): state.show → html classes.
import { state, set } from './state.js';
export function applyShow() {
  const html = document.documentElement, s = state.show;
  html.classList.toggle('no-ui', !s.ui); html.classList.toggle('no-swimmer', !s.swimmer); html.classList.toggle('no-streaks', !s.streaks);
}
export function toggleShow(k) { set({ show: { ...state.show, [k]: !state.show[k] } }); applyShow(); }
