import { createRouter, createWebHistory } from "vue-router";
import Home from "./views/Home.vue";

// One interactive view; the /person/:slug route pre-selects a person so the URL
// is shareable and indexable. Both routes render Home — selection is driven by
// the route param, read in Home.
export const routes = [
  { path: "/", name: "home", component: Home },
  { path: "/person/:slug", name: "person", component: Home },
  // "who was alive in <year>" — a text-first, indexable era page (prerendered per
  // decade for SEO, but the route resolves any year the visitor types)
  { path: "/alive-in/:year", name: "alive-in", component: () => import("./views/AliveIn.vue") },
  // lazy: globe.gl + three (~600 KB) only downloads when the globe is opened
  { path: "/globe", name: "globe", component: () => import("./views/Globe.vue") },
];

export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
    scrollBehavior: () => ({ top: 0 }),
  });

  // SPA page views: gtag's auto page_view is disabled (index.html), so send one
  // on every navigation, including the first. page_path distinguishes each person.
  router.afterEach((to) => {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "page_view", {
        page_path: to.fullPath,
        page_location: window.location.href,
        page_title: document.title,
      });
    }
  });

  return router;
}
