/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

const tokyoNight = {
  dark: true,
  colors: {
    background: "#1a1b26",
    surface: "#24283b",
    primary: "#7aa2f7",
    secondary: "#b4f9f8",
    accent: "#ff9e64",
    error: "#f7768e",
    info: "#2ac3de",
    success: "#9ece6a",
    warning: "#e0af68",
  },
};

// Composables
import { createVuetify } from "vuetify";

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: "tokyoNight",
    themes: { tokyoNight },
  },
});
