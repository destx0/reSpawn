import '@angular/compiler';
import 'zone.js';
import { Component, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterOutlet, Router } from '@angular/router';
import {
  createAction,
  createReducer,
  on,
  props,
  provideStore,
  Store,
} from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { AsyncPipe, JsonPipe } from '@angular/common';

export const add = createAction('[Cart] Add', props<{ item: string }>());
export const step = createAction('[Wizard] Step', props<{ step: number }>());
const cart = createReducer<string[]>(
  [],
  on(add, (s, { item }) => [...s, item]),
);
const wizard = createReducer(
  { step: 0 },
  on(step, (s, a) => ({ step: a.step })),
);

@Component({ standalone: true, template: '<h2 id="page">home</h2>' })
class Home {}
@Component({ standalone: true, template: '<h2 id="page">workflow</h2>' })
class Workflow {}
@Component({ standalone: true, template: '<h2 id="page">detail</h2>' })
class Detail {}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AsyncPipe, JsonPipe],
  template: `<pre id="state">{{ state$ | async | json }}</pre>
    <div id="url">{{ router.url }}</div>
    <router-outlet />`,
})
class App {
  store = inject(Store);
  router = inject(Router);
  state$ = this.store.select((s) => s);
  constructor() {
    (window as any).ngTest = {
      add: (item: string) => this.store.dispatch(add({ item })),
      step: (n: number) => this.store.dispatch(step({ step: n })),
      navigate: (url: string) => this.router.navigateByUrl(url),
    };
  }
}

bootstrapApplication(App, {
  providers: [
    provideRouter([
      { path: '', component: Home },
      { path: 'workflow', component: Workflow },
      { path: 'workflow/detail', component: Detail },
    ]),
    provideStore({ cart, wizard }),
    provideStoreDevtools({ name: 'ng e2e', maxAge: 25 }),
  ],
});
