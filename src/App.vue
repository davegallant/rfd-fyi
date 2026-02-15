<script>
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import "vue-loading-overlay/dist/css/index.css";
import "./theme.css";

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
    // Initialize theme on next tick
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
      const savedTheme = localStorage.getItem('theme');
      if (!savedTheme) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = prefersDark ? 'dark' : 'light';
        this.applyTheme(theme);
      } else {
        this.currentTheme = savedTheme;
        // Apply saved theme
        this.applyTheme(savedTheme);
      }
    },
    setupThemeListener() {
      // Listen for system theme preference changes
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

      this.mediaQueryListener = darkModeQuery;

      // Use arrow function to preserve 'this' context
      const themeChangeHandler = (e) => {
        // Only auto-update theme if user hasn't set a preference manually
        const savedTheme = localStorage.getItem('theme');
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
      this.currentTheme = theme;
      localStorage.setItem('theme', theme);

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

<template>
  <div id="app">
    <link rel="shortcut icon" type="image/png" href="/favicon.png" />
    <div class="container">
      <div class="header">
        <div class="header-controls">
          <input
            v-model="filter"
            type="text"
            placeholder="Filter deals"
            ref="filter"
            @keyup.enter="createFilterRoute(filter.toString())"
            @keyup.esc="$refs.filter.blur()"
            class="search-input"
          />
          <button @click="toggleTheme" class="theme-toggle" :title="'Switch to ' + (currentTheme === 'dark' ? 'light' : 'dark') + ' theme'">
            <span class="material-symbols-outlined">{{ currentTheme === 'dark' ? 'light_mode' : 'dark_mode' }}</span>
          </button>
        </div>
      </div>

        <div class="cards-grid">
          <div
            v-for="topic in filteredTopics"
            :key="topic.topic_id"
            class="deal-card"
          >
            <div class="card-header">
              <div class="title-with-link">
                <a
                  :href="`https://forums.redflagdeals.com${topic.web_path}`"
                  target="_blank"
                  class="deal-title"
                  @click.stop
                  v-html="highlightMatches(topic.title)"
                ></a>
                <a
                  v-if="topic.Offer.url"
                  :href="topic.Offer.url"
                  target="_blank"
                  class="card-link"
                  title="Open deal"
                >
                  <span class="material-symbols-outlined">open_in_new</span>
                </a>
              </div>
              <div class="score-bubble" :class="{ positive: topic.score > 0, negative: topic.score < 0, neutral: topic.score === 0 }">
                <span v-if="topic.score > 0">+{{ topic.score }}</span>
                <span v-else>{{ topic.score }}</span>
              </div>
            </div>

            <div class="card-meta">
              <span class="dealer-name" v-html="highlightDealerName(topic.Offer.dealer_name)"></span>
            </div>

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
    </div>
</template>
