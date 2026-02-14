/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com
 */

// Styles
import "@mdi/font/css/materialdesignicons.css";
import "vuetify/styles";

// Composables
import { createVuetify } from "vuetify";

const lightTheme = {
  dark: false,
  colors: {
    background: "#ffffff",
    surface: "#f5f5f5",
    primary: "#1976d2",
    secondary: "#424242",
    accent: "#82b1ff",
    error: "#f44336",
    info: "#2196f3",
    success: "#4caf50",
    warning: "#ff9800",
  },
};

const darkTheme = {
  dark: true,
  colors: {
    background: "#1a1a1a",
    surface: "#2a2a2a",
    primary: "#5b9cf5",
    secondary: "#a0a0a0",
    accent: "#7aa2f7",
    error: "#f87171",
    info: "#60a5fa",
    success: "#4ade80",
    warning: "#facc15",
  },
};

function getDefaultTheme() {
  // Check for saved theme preference
  const savedTheme = localStorage.getItem('vuetify-theme');
  if (savedTheme) {
    return savedTheme;
  }

  // Check system preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

// Create vuetify instance
const vuetify = createVuetify({
  theme: {
    defaultTheme: getDefaultTheme(),
    themes: {
      light: lightTheme,
      dark: darkTheme,
    },
  },
});

// Export the vuetify instance so other parts of the app can access it
export { vuetify as default };