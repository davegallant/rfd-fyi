import { createApp } from "vue";
import App from "./App.vue";
import { createRouter, createWebHashHistory } from "vue-router";

import "./theme.css";

import { registerPlugins } from "@/plugins";

const routes = [
  {
    path: '/:pathMatch(.*)*',
    component: App,
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

const app = createApp(App);

registerPlugins(app);

app.use(router);
app.mount("#app");
