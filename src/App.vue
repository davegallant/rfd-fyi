<script>
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import { getFilteredSortedTopics, parseFilterTerm } from "./filterTopics.js";
import { loadUiPreferences, persistUiPreferences } from "./preferences.js";

import "./theme.css";

dayjs.extend(utc);

// Color palette for dealer labels - muted, visually distinct colors
const DEALER_COLORS = [
  { bg: '#e8eef4', border: '#5a7a9a', text: '#4a6a8a' },  // Muted Blue
  { bg: '#ece8f0', border: '#7a6a8a', text: '#6a5a7a' },  // Muted Purple
  { bg: '#e8f0e8', border: '#5a7a5a', text: '#4a6a4a' },  // Muted Green
  { bg: '#f0ebe5', border: '#9a7a5a', text: '#8a6a4a' },  // Muted Orange
  { bg: '#f0e8ec', border: '#8a5a6a', text: '#7a4a5a' },  // Muted Pink
  { bg: '#e5efed', border: '#5a7a75', text: '#4a6a65' },  // Muted Teal
  { bg: '#f0ede5', border: '#9a8a5a', text: '#8a7a4a' },  // Muted Amber
  { bg: '#eaf0e8', border: '#6a8a5a', text: '#5a7a4a' },  // Muted Light Green
  { bg: '#e8e9f0', border: '#5a5a8a', text: '#4a4a7a' },  // Muted Indigo
  { bg: '#ece9e6', border: '#6a5a50', text: '#5a4a40' },  // Muted Brown
  { bg: '#e5f0f0', border: '#5a8a8a', text: '#4a7a7a' },  // Muted Cyan
  { bg: '#f0e8e5', border: '#9a6a5a', text: '#8a5a4a' },  // Muted Deep Orange
];

// Dark theme color palette - muted colors
const DEALER_COLORS_DARK = [
  { bg: '#2a3a4a', border: '#7a9ab0', text: '#9ab0c0' },  // Muted Blue
  { bg: '#3a3040', border: '#9a8aaa', text: '#b0a0c0' },  // Muted Purple
  { bg: '#2a3a2a', border: '#7a9a7a', text: '#9ab09a' },  // Muted Green
  { bg: '#3a3025', border: '#a09070', text: '#b0a080' },  // Muted Orange
  { bg: '#3a2a30', border: '#a07a8a', text: '#b09aa0' },  // Muted Pink
  { bg: '#253a38', border: '#7a9a95', text: '#9ab0aa' },  // Muted Teal
  { bg: '#3a3525', border: '#a09a70', text: '#b0aa80' },  // Muted Amber
  { bg: '#2a3a25', border: '#8a9a7a', text: '#a0b090' },  // Muted Light Green
  { bg: '#30304a', border: '#8a8aaa', text: '#a0a0c0' },  // Muted Indigo
  { bg: '#352d28', border: '#8a7a70', text: '#a09a90' },  // Muted Brown
  { bg: '#253a3a', border: '#7a9a9a', text: '#9ab0b0' },  // Muted Cyan
  { bg: '#3a2a25', border: '#a08070', text: '#b09a8a' },  // Muted Deep Orange
];

// Simple hash function for consistent color assignment
function hashString(str) {
  let hash = 0;
  const normalizedStr = str.toLowerCase().trim();
  for (let i = 0; i < normalizedStr.length; i++) {
    const char = normalizedStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export default {
  data() {
    return {
      filterInput: "",
      activeFilters: this.parseFiltersFromUrl(),
      sortMethod: "score",
      sortDropdownOpen: false,
      topics: [],
      isMobile: false,
      currentTheme: "auto",
      darkModeQuery: null,
      themeChangeHandler: null,
      isLoading: false,
      menuOpen: false,
      infoOverlayVisible: false,
    };
  },

  mounted() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("click", this.handleClickOutside);
    this.detectMobile();
    this.fetchDeals();
    this.initializeSortMethod();
    this.initializeTheme();
    this.setupThemeListener();
  },

  beforeUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("click", this.handleClickOutside);
    if (this.darkModeQuery && this.themeChangeHandler) {
      this.darkModeQuery.removeEventListener("change", this.themeChangeHandler);
    }
  },

  computed: {
    filteredTopics() {
      return getFilteredSortedTopics(this.topics, this.activeFilters, this.sortMethod);
    },

    isRegexError() {
      return parseFilterTerm(this.filterInput).isRegexError;
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

    sortOptions() {
      return [
        { key: "title", label: "Title", icon: "sort_by_alpha" },
        { key: "post_time", label: "Last Reply", icon: "schedule" },
        { key: "thread_start", label: "Thread Start", icon: "event" },
        { key: "score", label: "Score", icon: "trending_up" },
        { key: "replies", label: "Replies", icon: "chat" },
        { key: "views", label: "Views", icon: "visibility" },
      ];
    },

    currentSortOption() {
      return this.sortOptions.find(o => o.key === this.sortMethod) || this.sortOptions[3];
    },

  },

  methods: {
    formatDate(dateString) {
      return dayjs(String(dateString)).format("YYYY-MM-DD hh:mm A");
    },

    highlightText(text) {
      if (!this.activeFilters || this.activeFilters.length === 0) return text;

      let result = text;
      for (const filter of this.activeFilters) {
        const { regex, literal, isRegexError } = parseFilterTerm(filter);
        if (regex && !isRegexError) {
          // Use a version of the regex with the global flag for replace
          const globalRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
          result = result.replace(globalRegex, (match) => `<mark>${match}</mark>`);
        } else {
          // Plain literal: case-insensitive substring highlight
          const lowerText = result.toLowerCase();
          const lowerFilter = literal.toLowerCase();
          if (lowerFilter && lowerText.includes(lowerFilter)) {
            const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const substringRegex = new RegExp(escaped, "ig");
            result = result.replace(substringRegex, (match) => `<mark>${match}</mark>`);
          }
        }
      }
      return result;
    },

    initializeTheme() {
      const savedTheme = loadUiPreferences().theme;
      this.currentTheme = savedTheme;
      this.applyTheme(savedTheme, true);
    },

    setupThemeListener() {
      this.darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

      this.themeChangeHandler = (e) => {
        if (loadUiPreferences().theme === "auto") {
          this.applyThemeActual(e.matches ? "dark" : "light");
        }
      };

      this.darkModeQuery.addEventListener("change", this.themeChangeHandler);
    },

    applyTheme(theme, skipSave = false) {
      this.currentTheme = theme;

      if (!skipSave) {
        persistUiPreferences({ ...loadUiPreferences(), theme });
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
        this.$refs.filterInput.focus();
      }

      if (event.key === "r" && !isInput) {
        event.preventDefault();
        this.fetchDeals();
      }

      if (event.key === "i" && !isInput) {
        event.preventDefault();
        this.toggleInfoOverlay();
      }

      if (event.key === "Escape" && this.infoOverlayVisible) {
        event.preventDefault();
        this.toggleInfoOverlay();
      }

      if (event.key === "s" && !isInput) {
        event.preventDefault();
        const keys = this.sortOptions.map(o => o.key);
        const idx = keys.indexOf(this.sortMethod);
        this.setSortMethod(keys[(idx + 1) % keys.length]);
      }

      if (event.key === "t" && !isInput) {
        event.preventDefault();
        this.toggleTheme();
      }
    },

    parseFiltersFromUrl() {
      const searchParam = new URLSearchParams(window.location.search).get("filters");
      if (searchParam) {
        try {
          const parsed = JSON.parse(searchParam);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      }
      const hash = window.location.hash || "";
      const match = hash.match(/filters=([^&]*)/);
      if (match && match[1]) {
        try {
          const decoded = decodeURIComponent(match[1]);
          const parsed = JSON.parse(decoded);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          return [];
        }
      }
      const legacyMatch = hash.match(/filter=([^&]*)/);
      if (legacyMatch && legacyMatch[1]) {
        const decoded = decodeURIComponent(legacyMatch[1]);
        return decoded ? [decoded] : [];
      }
      return [];
    },

    updateUrlWithFilters() {
      if (this.activeFilters.length > 0) {
        this.$router.replace({
          path: "/",
          query: { filters: JSON.stringify(this.activeFilters) },
        });
      } else {
        this.$router.replace({ path: "/", query: {} });
      }
    },

    applyFilter() {
      const trimmed = this.filterInput.trim();
      if (trimmed && !this.activeFilters.includes(trimmed)) {
        this.activeFilters.push(trimmed);
        this.filterInput = "";
        this.$refs.filterInput.blur();
        this.updateUrlWithFilters();
      }
    },

    clearFilter(index) {
      this.activeFilters.splice(index, 1);
      this.updateUrlWithFilters();
    },

    clearAllFilters() {
      this.activeFilters = [];
      this.filterInput = "";
      this.updateUrlWithFilters();
    },

    fetchDeals() {
      this.isLoading = true;
      const minLoadingTime = new Promise(resolve => setTimeout(resolve, 500));

      Promise.all([
        axios.get("/topics.json"),
        minLoadingTime
      ])
        .then(([response]) => {
          this.topics = response.data;
        })
        .catch((err) => {
          console.error("Failed to fetch deals:", err.response || err);
        })
        .finally(() => {
          this.isLoading = false;
        });
    },

    initializeSortMethod() {
      this.sortMethod = loadUiPreferences().sortMethod;
    },

    setSortMethod(method) {
      this.sortMethod = method;
      this.sortDropdownOpen = false;
      persistUiPreferences({ ...loadUiPreferences(), sortMethod: method });
    },

    toggleSortDropdown() {
      this.sortDropdownOpen = !this.sortDropdownOpen;
    },

    toggleMenu() {
      this.menuOpen = !this.menuOpen;
    },

    closeMenu() {
      this.menuOpen = false;
    },

    handleMenuAction(action) {
      action();
      this.closeMenu();
    },

    handleClickOutside(event) {
      if (this.menuOpen && !event.target.closest('.mobile-menu-wrapper')) {
        this.closeMenu();
      }
      if (this.sortDropdownOpen && !event.target.closest('.sort-dropdown-wrapper')) {
        this.sortDropdownOpen = false;
      }
    },

    getDealerColor(dealerName) {
      if (!dealerName) return null;
      const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark' ||
                     document.documentElement.classList.contains('dark-theme') ||
                     (this.currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const colors = isDark ? DEALER_COLORS_DARK : DEALER_COLORS;
      const index = hashString(dealerName) % colors.length;
      return colors[index];
    },

    getDealerStyle(dealerName) {
      const color = this.getDealerColor(dealerName);
      if (!color) return {};
      return {
        backgroundColor: color.bg,
        borderColor: color.border,
        color: color.text,
      };
    },
    toggleInfoOverlay() {
      this.infoOverlayVisible = !this.infoOverlayVisible;
    },
  },
};
</script>

<template>
  <div id="app">
    <div class="container">
      <div class="header">
        <div class="header-controls">
          <div class="filter-wrapper">
            <div class="filter-container" :class="{ 'has-active-filters': activeFilters.length > 0 }">
              <span v-for="(filter, index) in activeFilters" :key="index" class="filter-tag">
                {{ filter }}
                <button class="filter-tag-clear" @click="clearFilter(index)" title="Clear filter">
                  <span class="material-symbols-outlined">close</span>
                </button>
              </span>
              <input
                ref="filterInput"
                v-model="filterInput"
                type="text"
                placeholder="filter - supports /regex/"
                class="search-input"
                :class="{ 'search-input--regex-error': isRegexError }"
                :title="isRegexError ? 'Invalid regex' : ''"
              @keyup.enter="applyFilter"
              @keyup.esc="$refs.filterInput.blur()"
            />
            </div>
          </div>
          <!-- Desktop buttons -->
          <button class="icon-button desktop-only" title="Refresh deals" @click="fetchDeals" :disabled="isLoading">
            <span class="material-symbols-outlined" :class="{ 'spinning': isLoading }">refresh</span>
          </button>
          <div class="sort-dropdown-wrapper desktop-only">
            <button class="icon-button" :title="'Sort: ' + currentSortOption.label" @click="toggleSortDropdown">
              <span class="material-symbols-outlined">sort</span>
            </button>
            <div class="sort-dropdown" v-if="sortDropdownOpen" @click.stop>
              <button
                v-for="opt in sortOptions"
                :key="opt.key"
                class="dropdown-item"
                :class="{ active: sortMethod === opt.key }"
                @click="setSortMethod(opt.key)"
              >
                <span class="material-symbols-outlined">{{ opt.icon }}</span>
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>
          <button class="icon-button desktop-only" :title="themeTitle" @click="toggleTheme">
            <span class="material-symbols-outlined">{{ themeIcon }}</span>
          </button>
          <button class="icon-button desktop-only" title="Info" @click="toggleInfoOverlay">
            <span class="material-symbols-outlined">info</span>
          </button>
          <div class="mobile-menu-wrapper mobile-only">
            <button class="icon-button" title="Menu" @click="toggleMenu">
              <span class="material-symbols-outlined">{{ menuOpen ? 'close' : 'menu' }}</span>
            </button>
            <div class="mobile-dropdown" v-if="menuOpen" @click.stop>
              <button class="dropdown-item" @click="handleMenuAction(fetchDeals)" :disabled="isLoading">
                <span class="material-symbols-outlined" :class="{ 'spinning': isLoading }">refresh</span>
                <span>Refresh</span>
              </button>
              <div class="dropdown-divider"></div>
              <div class="dropdown-section-label">Sort by</div>
              <button
                v-for="opt in sortOptions"
                :key="opt.key"
                class="dropdown-item"
                :class="{ active: sortMethod === opt.key }"
                @click="handleMenuAction(() => setSortMethod(opt.key))"
              >
                <span class="material-symbols-outlined">{{ opt.icon }}</span>
                <span>{{ opt.label }}</span>
              </button>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item" @click="handleMenuAction(toggleInfoOverlay)">
                <span class="material-symbols-outlined">info</span>
                <span>Info</span>
              </button>
              <button class="dropdown-item" @click="handleMenuAction(toggleTheme)">
                <span class="material-symbols-outlined">{{ themeIcon }}</span>
                <span>{{ themeTitle.split('(')[0].trim() }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="isLoading && topics.length === 0" class="loading-container">
        <span class="material-symbols-outlined spinning loading-spinner">refresh</span>
        <p>Loading deals...</p>
      </div>
      <div class="cards-wrapper" v-else>
        <div v-if="isLoading" class="loading-overlay">
          <span class="material-symbols-outlined spinning loading-spinner">refresh</span>
        </div>
        <div class="list-view">
        <div v-for="topic in filteredTopics" :key="topic.topic_id" class="deal-row">
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
                title="Open direct link to deal"
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
          <div class="card-meta" v-if="topic.Offer.dealer_name">
            <span
              class="dealer-name dealer-label"
              :style="getDealerStyle(topic.Offer.dealer_name)"
              v-html="highlightText(topic.Offer.dealer_name)"
            ></span>
          </div>
          <div class="row-stats">
            <span class="stat-compact">{{ formatDate(topic.post_time) }} - {{ formatDate(topic.last_post_time) }}</span>
          </div>
        </div>
        </div>
      </div>
    </div>
    <InfoOverlay :visible="infoOverlayVisible" @close="toggleInfoOverlay" />
  </div>
  </template>

<style scoped>
.sort-dropdown-wrapper {
  position: relative;
}

.sort-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  box-shadow: 0 4px 12px var(--shadow-medium);
  min-width: 170px;
  z-index: 100;
  overflow: hidden;
}

.cards-wrapper {
  position: relative;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(128, 128, 128, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 12px;
}

.loading-overlay .loading-spinner {
  font-size: 48px;
  color: var(--text-primary);
}

/* ============================================
   Filter Wrapper & Regex UI
   ============================================ */

.filter-wrapper {
  flex: 1;
  max-width: 500px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Override filter-container's own flex sizing since wrapper owns the width */
.filter-wrapper .filter-container {
  max-width: 100%;
  flex: unset;
}

.search-input--regex-error {
  border-color: #c0392b !important;
  box-shadow: 0 0 0 2px rgba(192, 57, 43, 0.25) !important;
}

</style>
