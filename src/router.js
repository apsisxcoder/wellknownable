import { createRouter, createWebHistory } from "vue-router";
import Home from "./views/Home.vue";

// One interactive view; the /person/:slug route pre-selects a person so the URL
// is shareable and indexable. Both routes render Home — selection is driven by
// the route param, read in Home.
export const routes = [
  { path: "/", name: "home", component: Home },
  { path: "/person/:slug", name: "person", component: Home },
];

export function createAppRouter() {
  return createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
    scrollBehavior: () => ({ top: 0 }),
  });
}
