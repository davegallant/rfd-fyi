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
      sortMethod: 'score',
      topics: [],
      isMobile: false,
      currentTheme: typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') || 'auto') : 'auto',
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
    // Initialize sort method from local storage
    this.initializeSortMethod();
    // Initialize theme immediately to prevent flash
    this.initializeTheme();
    this.setupThemeListener();
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
      // If no saved preference, default to auto
      const savedTheme = localStorage.getItem('theme');
      if (!savedTheme) {
        this.currentTheme = 'auto';
        this.applyTheme('auto', true); // skipSave=true to avoid redundant write
      } else {
        this.currentTheme = savedTheme;
        // Apply saved theme (skipSave=true since it's already saved)
        this.applyTheme(savedTheme, true);
      }
    },
    setupThemeListener() {
      // Listen for system theme preference changes
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

      this.mediaQueryListener = darkModeQuery;

      // Use arrow function to preserve 'this' context
      const themeChangeHandler = (e) => {
        // Only auto-update theme if set to 'auto'
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'auto' || !savedTheme) {
          const newTheme = e.matches ? 'dark' : 'light';
          console.log('System theme changed to:', newTheme);
          this.applyThemeActual(newTheme);
        }
      };

      darkModeQuery.addEventListener('change', themeChangeHandler);
      // Store the handler so we can remove it later if needed
      this.themeChangeHandler = themeChangeHandler;
      this.darkModeQuery = darkModeQuery;
    },
    applyTheme(theme, skipSave = false) {
      this.currentTheme = theme;
      if (!skipSave) {
        localStorage.setItem('theme', theme);
      }

      // Determine actual theme to apply
      let actualTheme = theme;
      if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        actualTheme = prefersDark ? 'dark' : 'light';
      }

      this.applyThemeActual(actualTheme);
    },
    applyThemeActual(actualTheme) {
      // Update data-bs-theme attribute for CSS variables to work
      document.documentElement.setAttribute('data-bs-theme', actualTheme === 'dark' ? 'dark' : 'light');

      // Update HTML class for theme-based CSS selectors
      if (actualTheme === 'dark') {
        document.documentElement.classList.add('dark-theme');
        document.documentElement.classList.remove('light-theme');
      } else {
        document.documentElement.classList.add('light-theme');
        document.documentElement.classList.remove('dark-theme');
      }
    },
    toggleTheme() {
      // Cycle through: auto -> light -> dark -> auto
      let newTheme;
      if (this.currentTheme === 'auto') {
        newTheme = 'light';
      } else if (this.currentTheme === 'light') {
        newTheme = 'dark';
      } else {
        newTheme = 'auto';
      }
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
      let filtered = this.topics
        .filter((row) => {
          const titles = (
            row.title.toString() +
            " [" +
            row.Offer.dealer_name +
            "]"
          ).toLowerCase();
          const filterTerm = this.filter.toLowerCase();
          return titles.includes(filterTerm);
        });

      // Sort based on selected method
      if (this.sortMethod === 'score') {
        return filtered.sort((a, b) => b.score - a.score);
      } else if (this.sortMethod === 'views') {
        return filtered.sort((a, b) => b.total_views - a.total_views);
      } else {
        return filtered.sort((a, b) => new Date(b.last_post_time) - new Date(a.last_post_time));
      }
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
    getThemeIcon() {
      if (this.currentTheme === 'auto') {
        return 'brightness_auto';
      } else if (this.currentTheme === 'dark') {
        return 'light_mode';
      } else {
        return 'dark_mode';
      }
    },
    getThemeTitle() {
      if (this.currentTheme === 'auto') {
        return 'Theme: Auto (click for Light)';
      } else if (this.currentTheme === 'light') {
        return 'Theme: Light (click for Dark)';
      } else {
        return 'Theme: Dark (click for Auto)';
      }
    },
    initializeSortMethod() {
      const saved = localStorage.getItem('sortMethod');
      if (saved) {
        this.sortMethod = saved;
      }
    },
    toggleSort() {
      // Cycle through: score -> views -> recency -> score
      if (this.sortMethod === 'score') {
        this.sortMethod = 'views';
      } else if (this.sortMethod === 'views') {
        this.sortMethod = 'recency';
      } else {
        this.sortMethod = 'score';
      }
      localStorage.setItem('sortMethod', this.sortMethod);
    },
    getSortIcon() {
      if (this.sortMethod === 'score') {
        return 'trending_up';
      } else if (this.sortMethod === 'views') {
        return 'visibility';
      } else {
        return 'schedule';
      }
    },
    getSortTitle() {
      if (this.sortMethod === 'score') {
        return 'Sort by Score (click for Views)';
      } else if (this.sortMethod === 'views') {
        return 'Sort by Views (click for Recency)';
      } else {
        return 'Sort by Recency (click for Score)';
      }
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
          <button @click="toggleSort" class="sort-toggle" :title="getSortTitle">
            <span class="material-symbols-outlined">{{ getSortIcon }}</span>
          </button>
          <button @click="toggleTheme" class="theme-toggle" :title="getThemeTitle">
            <span class="material-symbols-outlined">{{ getThemeIcon }}</span>
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
