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
      hoveredTopicId: null,
      tooltipData: {},
      loadingTooltip: {},
      tooltipPosition: { x: 0, y: 0 },
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
      // Apply theme using Vuetify's theme API
      this.$vuetify.theme.global.name = theme;
      this.currentTheme = theme;
      localStorage.setItem('vuetify-theme', theme);

      // Also update data-bs-theme for any custom CSS that uses it
      document.documentElement.setAttribute('data-bs-theme', theme === 'dark' ? 'dark' : 'light');
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
    handleTitleHover(topic, event) {
      // Don't load tooltips on mobile devices
      if (this.isMobile) {
        return;
      }
      this.hoveredTopicId = topic.topic_id;
      this.tooltipPosition = {
        x: event.clientX,
        y: event.clientY,
      };
      this.loadTopicDetails(topic.topic_id);
    },
    handleTitleLeave() {
      if (this.isMobile) {
        return;
      }
      this.hoveredTopicId = null;
    },
    handleMouseMove(event) {
      if (this.isMobile) {
        return;
      }
      if (this.hoveredTopicId !== null) {
        this.tooltipPosition = {
          x: event.clientX,
          y: event.clientY,
        };
      }
    },
    loadTopicDetails(topicId) {
      if (!topicId) {
        console.warn("Topic ID is undefined");
        return;
      }

      if (this.tooltipData[topicId]) {
        return; // Already loaded
      }

      if (this.loadingTooltip[topicId]) {
        return; // Already loading
      }

      this.loadingTooltip[topicId] = true;

      axios
        .get(`api/v1/topics/${topicId}`)
        .then((response) => {
          this.tooltipData[topicId] = response.data;
        })
        .catch((err) => {
          console.log("Error loading topic details:", err);
        })
        .finally(() => {
          this.loadingTooltip[topicId] = false;
        });
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
      return this.topics.filter((row) => {
        const titles = (
          row.title.toString() +
          " [" +
          row.Offer.dealer_name +
          "]"
        ).toLowerCase();
        const filterTerm = this.filter.toLowerCase();
        return titles.includes(filterTerm);
      });
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
    visibleHeaders() {
      const baseHeaders = [
        { title: "Deal", value: "title", align: "center" },
        { title: "Score", value: "score", align: "center" },
      ];

      // Only show Last Post column on desktop
      if (!this.isMobile) {
        baseHeaders.push({
          title: "Last Post",
          value: "last_post_time",
          align: "center",
        });
      }

      return baseHeaders;
    },
    tooltipStyle() {
      if (this.hoveredTopicId === null || !this.tooltipData[this.hoveredTopicId]) {
        return {};
      }

      let top = this.tooltipPosition.y + 10;
      let left = this.tooltipPosition.x + 10;
      const tooltipWidth = 420;

      // Check if tooltip would go off right side of screen
      if (left + tooltipWidth > window.innerWidth) {
        // Position to the left of cursor instead
        left = Math.max(10, this.tooltipPosition.x - tooltipWidth - 10);
      }

      // Keep tooltip within vertical bounds, allowing scrolling of content
      top = Math.max(10, Math.min(top, window.innerHeight - 100));

      return {
        position: 'fixed',
        left: Math.max(10, left) + 'px',
        top: top + 'px',
        zIndex: 9999,
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
      <body>
        <v-text-field
          v-model="filter"
          label="Filter"
          ref="filter"
          @keyup.enter="createFilterRoute(filter.toString())"
          @keyup.esc="$refs.filter.blur()"
          hide-details="true"
        />
        <v-data-table
          :headers="visibleHeaders"
          :items="filteredTopics"
          :sort-by="sortBy"
          :items-per-page="50"
        >
          <template #item.title="{ item }">
            <a
              :href="`https://forums.redflagdeals.com${item.web_path}`"
              target="_blank"
              @mouseenter="handleTitleHover(item, $event)"
              @mouseleave="handleTitleLeave"
              @mousemove="handleMouseMove"
              v-html="
                highlightMatches(
                  item.title
                )
              "
            ></a>
          </template>

          <template #item.score="{ item }">
            <span v-if="item.score > 0" class="green-score"
              >+{{ item.score }}</span
            >
            <span v-else-if="item.score < 0" class="red-score">{{
              item.score
            }}</span>
            <span v-else>{{ item.score }}</span>
          </template>

          <template #item.last_post_time="{ item }">
            {{ formatDate(item.last_post_time) }}
          </template>

          <template #loading>
            <v-progress-linear indeterminate color="grey" />
          </template>
        </v-data-table>

        <!-- Tooltip for deal details -->
        <div
          v-if="hoveredTopicId !== null && tooltipData[hoveredTopicId]"
          class="deal-tooltip"
          :style="tooltipStyle"
        >
          <div class="tooltip-content">
              <div class="tooltip-stats">
                <span class="stat-item">
                  <span class="material-symbols-outlined">visibility</span>
                  {{ tooltipData[hoveredTopicId].topic.total_views }} views
                </span>
                <span class="stat-item">
                  <span class="material-symbols-outlined">chat</span>
                  {{ tooltipData[hoveredTopicId].topic.total_replies }} replies
                </span>
              </div>
            <div v-if="tooltipData[hoveredTopicId].description" class="tooltip-description">
              <strong>Description:</strong>
              {{ tooltipData[hoveredTopicId].description }}
            </div>
            <div class="tooltip-dealer">
              {{ tooltipData[hoveredTopicId].topic.Offer.dealer_name }}
            </div>
            <div v-if="tooltipData[hoveredTopicId].first_post" class="tooltip-first-post">
              <strong>First Post:</strong>
              {{ tooltipData[hoveredTopicId].first_post }}
            </div>
            <div class="tooltip-times">
              <div>Posted: {{ formatDate(tooltipData[hoveredTopicId].topic.post_time) }}</div>
              <div>Last Post: {{ formatDate(tooltipData[hoveredTopicId].topic.last_post_time) }}</div>
            </div>
          </div>
        </div>
      </body>
    </v-main>
  </v-app>
</template>

<style scoped>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}

.fixed-bottom {
  background: #ffc;
  color: black;
}

.deal-tooltip {
  pointer-events: none;
  max-width: 400px;
}

.tooltip-content {
  background: var(--tooltip-bg);
  border: 2px solid var(--tooltip-border);
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease;
}

.tooltip-header {
  font-weight: bold;
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 8px;
  white-space: normal;
  word-wrap: break-word;
}

.tooltip-dealer {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.tooltip-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-item .material-symbols-outlined {
  font-size: 16px;
}

.tooltip-description {
  margin-bottom: 8px;
  padding: 8px;
  background: var(--bg-secondary);
  border-left: 2px solid var(--tooltip-border);
  border-radius: 2px;
  font-size: 12px;
  white-space: normal;
  word-wrap: break-word;
  max-height: 60px;
  overflow-y: auto;
  color: var(--text-primary);
}

.tooltip-first-post {
  margin-bottom: 8px;
  padding: 8px;
  background: var(--bg-secondary);
  border-left: 2px solid var(--tooltip-border);
  border-radius: 2px;
  font-size: 12px;
  white-space: normal;
  word-wrap: break-word;
  max-height: 60px;
  overflow-y: auto;
  color: var(--text-primary);
}

.tooltip-times {
  font-size: 11px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
  padding-top: 8px;
  margin-top: 8px;
}

/* Filter input styling */
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
</style>
