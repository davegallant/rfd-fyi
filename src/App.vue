<script>
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { ref } from "vue";

import "vue-loading-overlay/dist/css/index.css";

// Configure day.js with UTC support
dayjs.extend(utc);

export default {
  data() {
    return {
      ascending: this.ascending,
      filter: window.location.href.split("filter=")[1] || "",
      sortColumn: this.sortColumn,
      topics: [],
      isMobile: false,
      currentTheme: 'dark',
      mediaQueryListener: null,
      vuetifyTheme: null,
      darkModeQuery: null,
      themeChangeHandler: null,
    };
  },
  mounted() {
    window.addEventListener("keydown", this.handleKeyDown);
    this.detectMobile();
    this.fetchDeals();
    // Initialize theme on next tick to ensure Vuetify is ready
    this.$nextTick(() => {
      this.initializeTheme();
      this.setupThemeListener();
    });
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.detectMobile);
    if (this.darkModeQuery && this.themeChangeHandler) {
      this.darkModeQuery.removeEventListener('change', this.themeChangeHandler);
    }
  },
  methods: {
    initializeTheme() {
      // If no saved preference, apply system preference now
      const savedTheme = localStorage.getItem('vuetify-theme');
      if (!savedTheme) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = prefersDark ? 'dark' : 'light';
        this.applyTheme(theme);
      } else {
        // Get current theme name from Vuetify
        this.currentTheme = this.$vuetify.theme.global.name;
      }
    },
    setupThemeListener() {
      // Listen for system theme preference changes
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

      this.mediaQueryListener = darkModeQuery;

      // Use arrow function to preserve 'this' context
      const themeChangeHandler = (e) => {
        // Only auto-update theme if user hasn't set a preference manually
        const savedTheme = localStorage.getItem('vuetify-theme');
        if (!savedTheme) {
          const newTheme = e.matches ? 'dark' : 'light';
          console.log('System theme changed to:', newTheme);
          this.applyTheme(newTheme);
        }
      };

      darkModeQuery.addEventListener('change', themeChangeHandler);
      // Store the handler so we can remove it later if needed
      this.themeChangeHandler = themeChangeHandler;
      this.darkModeQuery = darkModeQuery;
    },
    applyTheme(theme) {
      // Apply theme using Vuetify's theme API (using .value for reactive ref)
      this.$vuetify.theme.global.name.value = theme;
      this.currentTheme = theme;
      localStorage.setItem('vuetify-theme', theme);

      // Update data-bs-theme attribute for CSS variables to work
      document.documentElement.setAttribute('data-bs-theme', theme === 'dark' ? 'dark' : 'light');

      // Update HTML class for theme-based CSS selectors
      if (theme === 'dark') {
        document.documentElement.classList.add('dark-theme');
        document.documentElement.classList.remove('light-theme');
      } else {
        document.documentElement.classList.add('light-theme');
        document.documentElement.classList.remove('dark-theme');
      }
    },
    toggleTheme() {
      const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
      this.applyTheme(newTheme);
    },
    detectMobile() {
      // Detect if device is mobile/tablet based on touch capability and screen size
      const hasTouch = () => {
        return (
          (typeof window !== "undefined" &&
            ("ontouchstart" in window ||
              navigator.maxTouchPoints > 0 ||
              navigator.msMaxTouchPoints > 0)) ||
          false
        );
      };

      const isMobileScreen = () => {
        return window.innerWidth <= 1024;
      };

      this.isMobile = hasTouch() || isMobileScreen();
      window.addEventListener("resize", this.detectMobile);
    },
    handleKeyDown(event) {
      const isInput = ["INPUT", "TEXTAREA"].includes(
        document.activeElement.tagName
      );
      if (event.key === "/" && !isInput) {
        event.preventDefault(); // prevent typing `/` into whatever is focused
        this.$refs.filter.focus();
      }
    },

    createFilterRoute(params) {
      this.$refs.filter.blur();
      history.pushState(
        {},
        null,
        `${window.location.origin}#/filter=${encodeURIComponent(params)}`
      );
    },
    fetchDeals() {
      axios
        .get("api/v1/topics")
        .then((response) => {
          this.topics = response.data;
        })
        .catch((err) => {
          console.log(err.response);
        });
    },
  },
  computed: {
    formatDate() {
      return (v) => {
        const date = dayjs(String(v));
        return date.format("YYYY-MM-DD hh:mm A");
      };
    },
    filteredTopics() {
      return this.topics
        .filter((row) => {
          const titles = (
            row.title.toString() +
            " [" +
            row.Offer.dealer_name +
            "]"
          ).toLowerCase();
          const filterTerm = this.filter.toLowerCase();
          return titles.includes(filterTerm);
        })
        .sort((a, b) => b.score - a.score); // Always sort by score descending
    },
    highlightMatches() {
      return (v) => {
        if (this.filter == "") return v;
        const matchExists = v.toLowerCase().includes(this.filter.toLowerCase());
        if (!matchExists) return v;

        const re = new RegExp(this.filter, "ig");
        return v.replace(re, (matchedText) => `<mark>${matchedText}</mark>`);
      };
    },
    highlightDealerName() {
      return (dealerName) => {
        if (this.filter == "") return dealerName;
        const matchExists = dealerName.toLowerCase().includes(this.filter.toLowerCase());
        if (!matchExists) return dealerName;

        const re = new RegExp(this.filter, "ig");
        return dealerName.replace(re, (matchedText) => `<mark>${matchedText}</mark>`);
      };
    },
  },
};
</script>

<script setup>
const sortBy = ref([{ key: "score", order: "desc" }]);
</script>

<template>
  <v-app>
    <v-main>
      <link rel="shortcut icon" type="image/png" href="/favicon.png" />
      <div class="container">
        <div class="header">
          <v-text-field
            v-model="filter"
            label="Filter deals"
            ref="filter"
            @keyup.enter="createFilterRoute(filter.toString())"
            @keyup.esc="$refs.filter.blur()"
            hide-details="true"
            class="search-input"
          />
        </div>

        <div class="cards-grid">
          <div
            v-for="topic in filteredTopics"
            :key="topic.topic_id"
            class="deal-card"
          >
            <div class="card-header">
              <a
                :href="`https://forums.redflagdeals.com${topic.web_path}`"
                target="_blank"
                class="deal-title"
                @click.stop
                v-html="highlightMatches(topic.title)"
              ></a>
              <div class="score-bubble" :class="{ positive: topic.score > 0, negative: topic.score < 0, neutral: topic.score === 0 }">
                <span v-if="topic.score > 0">+{{ topic.score }}</span>
                <span v-else>{{ topic.score }}</span>
              </div>
            </div>

            <div class="card-meta">
              <span class="dealer-name" v-html="highlightDealerName(topic.Offer.dealer_name)"></span>
            </div>

            <!-- Card details -->
            <div class="card-details">
              <div class="details-stats">
                <div class="stat">
                  <span class="material-symbols-outlined">visibility</span>
                  <span class="stat-value">{{ topic.total_views }} views</span>
                </div>
                <div class="stat">
                  <span class="material-symbols-outlined">chat</span>
                  <span class="stat-value">{{ topic.total_replies }} replies</span>
                </div>
              </div>

              <div class="card-timestamp">
                Last post: {{ formatDate(topic.last_post_time) }}
              </div>

            </div>
          </div>
        </div>
      </div>
    </v-main>
  </v-app>
</template>

<style scoped>
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
}

.header {
  margin-bottom: 30px;
}

.search-input {
  width: 100%;
  max-width: 500px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.deal-card {
  background-color: var(--bg-secondary);
  border: 1.5px solid #aaaaaa;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  transition: all 0.2s ease;
  cursor: pointer;
  min-height: auto;
}

.deal-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
  border-color: #888888;
}

.card-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.deal-title {
  color: var(--link-color);
  text-decoration: none;
  font-weight: 500;
  font-size: 15px;
  line-height: 1.4;
  flex: 1;
  transition: color 0.2s ease;
}

.deal-title:visited {
  color: var(--link-visited);
}

.deal-title:hover {
  text-decoration: underline;
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}

.dealer-name {
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 13px;
}

.card-timestamp {
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: 8px;
}

.score-bubble {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 50px;
  height: 40px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
  transition: all 0.2s ease;
  padding: 0 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  border: none;
}

.score-bubble.positive {
  background-color: rgb(34, 139, 34);
  color: white;
  box-shadow: 0 1px 3px rgba(34, 139, 34, 0.2);
}

html.light-theme .score-bubble.positive {
  background-color: rgb(34, 139, 34);
  color: white;
  box-shadow: 0 1px 3px rgba(34, 139, 34, 0.2);
}

html.dark-theme .score-bubble.positive {
  background-color: rgb(158, 206, 106);
  color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(158, 206, 106, 0.2);
}

.score-bubble.negative {
  background-color: rgb(247, 118, 142);
  color: white;
  box-shadow: 0 1px 3px rgba(247, 118, 142, 0.2);
}

.score-bubble.neutral {
  background-color: var(--text-secondary);
  color: var(--bg-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.card-details {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.details-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.stat .material-symbols-outlined {
  font-size: 18px;
}

.stat-value {
  font-weight: 500;
}

.details-section {
  margin-bottom: 12px;
}

.details-section strong {
  display: block;
  color: var(--text-primary);
  margin-bottom: 4px;
  font-size: 13px;
}

.details-section p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
  word-wrap: break-word;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }

  .container {
    padding: 12px;
  }

  .search-input {
    max-width: 100%;
  }
}

/* Mark highlighting */
:deep(mark) {
  background-color: rgba(255, 193, 7, 0.3);
  color: inherit;
  font-weight: 600;
  border-radius: 2px;
}

html.dark-theme :deep(mark) {
  background-color: rgba(255, 193, 7, 0.4);
  color: inherit;
  font-weight: 600;
  border-radius: 2px;
}

/* Vuetify overrides */
:deep(.v-text-field) {
  --v-field-border-color: #cccccc;
}

html[data-bs-theme="light"] :deep(.v-text-field) {
  --v-field-border-color: #e8e8e8;
}

html[data-bs-theme="light"] :deep(.v-field__input) {
  background-color: #d0d0d0 !important;
}

html[data-bs-theme="light"] :deep(.v-field--focused .v-field__input) {
  background-color: #e8e8e8 !important;
}

html[data-bs-theme="dark"] :deep(.v-text-field) {
  --v-field-border-color: #555555;
}

html.light-theme :deep(.v-text-field) {
  --v-field-border-color: #cccccc;
}

html.light-theme :deep(.v-field__input) {
  background-color: #d0d0d0 !important;
}

html.light-theme :deep(.v-field--focused .v-field__input) {
  background-color: #e8e8e8 !important;
}

html.dark-theme :deep(.v-text-field) {
  --v-field-border-color: #555555;
}

/* Ensure v-app and v-main use theme colors */
:deep(.v-app) {
  background-color: var(--bg-primary) !important;
  color: var(--text-primary) !important;
}

:deep(.v-main) {
  background-color: var(--bg-primary) !important;
}
</style>
