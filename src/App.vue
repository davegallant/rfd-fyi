<script>
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import "./theme.css";

dayjs.extend(utc);

export default {
  data() {
    return {
      filter: decodeURIComponent(window.location.href.split("filter=")[1] || ""),
      sortMethod: "score",
      topics: [],
      isMobile: false,
      currentTheme: "auto",
      darkModeQuery: null,
      themeChangeHandler: null,
    };
  },

  mounted() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("resize", this.handleResize);
    this.detectMobile();
    this.fetchDeals();
    this.initializeSortMethod();
    this.initializeTheme();
    this.setupThemeListener();
  },

  beforeUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.handleResize);
    if (this.darkModeQuery && this.themeChangeHandler) {
      this.darkModeQuery.removeEventListener("change", this.themeChangeHandler);
    }
  },

  computed: {
    filteredTopics() {
      const filterTerm = this.filter.toLowerCase();

      const filtered = this.topics.filter((row) => {
        const searchText = `${row.title} [${row.Offer.dealer_name}]`.toLowerCase();
        return searchText.includes(filterTerm);
      });

      const sortFns = {
        score: (a, b) => b.score - a.score,
        views: (a, b) => b.total_views - a.total_views,
        recency: (a, b) => new Date(b.last_post_time) - new Date(a.last_post_time),
      };

      return filtered.sort(sortFns[this.sortMethod] || sortFns.score);
    },

    themeIcon() {
      const icons = { auto: "brightness_auto", dark: "dark_mode", light: "light_mode" };
      return icons[this.currentTheme];
    },

    themeTitle() {
      const titles = {
        auto: "Theme: Auto (click for Light)",
        light: "Theme: Light (click for Dark)",
        dark: "Theme: Dark (click for Auto)",
      };
      return titles[this.currentTheme];
    },

    sortIcon() {
      const icons = { score: "trending_up", views: "visibility", recency: "schedule" };
      return icons[this.sortMethod];
    },

    sortTitle() {
      const titles = {
        score: "Sort by Score (click for Views)",
        views: "Sort by Views (click for Recency)",
        recency: "Sort by Recency (click for Score)",
      };
      return titles[this.sortMethod];
    },
  },

  methods: {
    formatDate(dateString) {
      return dayjs(String(dateString)).format("YYYY-MM-DD hh:mm A");
    },

    highlightText(text) {
      if (!this.filter) return text;

      const lowerText = text.toLowerCase();
      const lowerFilter = this.filter.toLowerCase();

      if (!lowerText.includes(lowerFilter)) return text;

      const regex = new RegExp(this.filter, "ig");
      return text.replace(regex, (match) => `<mark>${match}</mark>`);
    },

    initializeTheme() {
      const savedTheme = localStorage.getItem("theme") || "auto";
      this.currentTheme = savedTheme;
      this.applyTheme(savedTheme, true);
    },

    setupThemeListener() {
      this.darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

      this.themeChangeHandler = (e) => {
        const savedTheme = localStorage.getItem("theme");
        if (savedTheme === "auto" || !savedTheme) {
          this.applyThemeActual(e.matches ? "dark" : "light");
        }
      };

      this.darkModeQuery.addEventListener("change", this.themeChangeHandler);
    },

    applyTheme(theme, skipSave = false) {
      this.currentTheme = theme;

      if (!skipSave) {
        localStorage.setItem("theme", theme);
      }

      let actualTheme = theme;
      if (theme === "auto") {
        actualTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }

      this.applyThemeActual(actualTheme);
    },

    applyThemeActual(theme) {
      document.documentElement.setAttribute("data-bs-theme", theme);
      document.documentElement.classList.toggle("dark-theme", theme === "dark");
      document.documentElement.classList.toggle("light-theme", theme === "light");
    },

    toggleTheme() {
      const cycle = { auto: "light", light: "dark", dark: "auto" };
      this.applyTheme(cycle[this.currentTheme]);
    },

    detectMobile() {
      const hasTouch =
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        navigator.msMaxTouchPoints > 0;

      const isMobileScreen = window.innerWidth <= 1024;
      this.isMobile = hasTouch || isMobileScreen;
    },

    handleResize() {
      this.detectMobile();
    },

    handleKeyDown(event) {
      const isInput = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);

      if (event.key === "/" && !isInput) {
        event.preventDefault();
        this.$refs.filter.focus();
      }
    },

    createFilterRoute(params) {
      this.$refs.filter.blur();
      history.pushState({}, null, `${window.location.origin}#/filter=${encodeURIComponent(params)}`);
    },

    fetchDeals() {
      axios
        .get("api/v1/topics")
        .then((response) => {
          this.topics = response.data;
        })
        .catch((err) => {
          console.error("Failed to fetch deals:", err.response || err);
        });
    },

    initializeSortMethod() {
      const saved = localStorage.getItem("sortMethod");
      if (saved) {
        this.sortMethod = saved;
      }
    },

    toggleSort() {
      const cycle = { score: "views", views: "recency", recency: "score" };
      this.sortMethod = cycle[this.sortMethod];
      localStorage.setItem("sortMethod", this.sortMethod);
    },
  },
};
</script>

<template>
  <div id="app">
    <div class="container">
      <div class="header">
        <div class="header-controls">
          <input
            ref="filter"
            v-model="filter"
            type="text"
            placeholder="Filter deals"
            class="search-input"
            @keyup.enter="createFilterRoute(filter.toString())"
            @keyup.esc="$refs.filter.blur()"
          />
          <button class="icon-button" :title="sortTitle" @click="toggleSort">
            <span class="material-symbols-outlined">{{ sortIcon }}</span>
          </button>
          <button class="icon-button" :title="themeTitle" @click="toggleTheme">
            <span class="material-symbols-outlined">{{ themeIcon }}</span>
          </button>
        </div>
      </div>

      <div class="cards-grid">
        <div v-for="topic in filteredTopics" :key="topic.topic_id" class="deal-card">
          <div class="card-header">
            <div class="title-with-link">
              <a
                :href="`https://forums.redflagdeals.com${topic.web_path}`"
                target="_blank"
                class="deal-title"
                v-html="highlightText(topic.title)"
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
            <div
              class="score-bubble"
              :class="{
                positive: topic.score > 0,
                negative: topic.score < 0,
                neutral: topic.score === 0,
              }"
            >
              <span v-if="topic.score > 0">+{{ topic.score }}</span>
              <span v-else>{{ topic.score }}</span>
            </div>
          </div>

          <div class="card-meta">
            <span class="dealer-name" v-html="highlightText(topic.Offer.dealer_name)"></span>
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

            <div class="card-timestamp">Last post: {{ formatDate(topic.last_post_time) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
