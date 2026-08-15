<script>
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

import { attachTags, tagFilterTerm, tagSuggestions as suggestTagTerms, visibleTags } from "./enrichment.js";
import { getFilteredSortedTopics, getMerchantOptions, parseFilterTerm } from "./filterTopics.js";
import { loadUiPreferences, persistUiPreferences, SORT_METHOD_KEYS } from "./preferences.js";
import { exportLocalStorageSettings, importLocalStorageSettings } from "./settingsTransfer.js";
import { seen, markSeen, markUnseen, isSeen, markAllSeen, clearSeen, reloadSeenDeals } from "./composables/useSeenDeals.js";
import InfoOverlay from "./components/InfoOverlay.vue";

import "./theme.css";

dayjs.extend(utc);

const TOPICS_BATCH_SIZE = 100;
const INFINITE_SCROLL_THRESHOLD_PX = 600;

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
  components: {
    InfoOverlay,
  },

  setup() {
    return { seen, markSeen, markUnseen, markAllSeen, clearSeen, reloadSeenDeals };
  },

  data() {
    return {
      filterInput: "",
      // Canonical tag list published by /enrichment.json, used for # completion.
      tagVocabulary: [],
      // -1 = no suggestion highlighted, so Enter applies the filter as typed.
      tagSuggestionIndex: -1,
      tagCompletionDismissed: false,
      activeFilters: this.parseFiltersFromUrl(),
      sortMethod: "score",
      sortBySetByUser: false,
      sortDropdownOpen: false,
      topics: [],
      isMobile: false,
      currentTheme: "auto",
      resolvedTheme: "light",
      darkModeQuery: null,
      themeChangeHandler: null,
      isLoading: false,
      menuOpen: false,
      infoOverlayVisible: false,
      hideSeen: loadUiPreferences().hideSeen,
      hideBadDeals: loadUiPreferences().hideBadDeals,
      hiddenMerchants: loadUiPreferences().hiddenMerchants,
      merchantFilterInput: "",
      merchantDropdownOpen: false,
      mobileMerchantSheetOpen: false,
      mobileMerchantSearch: "",
      mobileMerchantBodyOverflow: null,
      seenDropdownOpen: false,
      visibleTopicCount: TOPICS_BATCH_SIZE,
      refreshIntervalId: null,
    };
  },

  mounted() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("scroll", this.handleScroll, { passive: true });
    window.addEventListener("click", this.handleClickOutside);
    this.detectMobile();
    this.fetchDeals();
    this.refreshIntervalId = window.setInterval(() => this.fetchDeals(), 5 * 60 * 1000);
    this.initializeSortMethod();
    this.initializeTheme();
    this.setupThemeListener();
  },

  beforeUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("scroll", this.handleScroll);
    window.removeEventListener("click", this.handleClickOutside);
    if (this.refreshIntervalId) {
      window.clearInterval(this.refreshIntervalId);
    }
    if (this.darkModeQuery && this.themeChangeHandler) {
      this.darkModeQuery.removeEventListener("change", this.themeChangeHandler);
    }
    this.restoreMobileMerchantScroll();
  },

  watch: {
    filterInput() {
      this.tagSuggestionIndex = -1;
      this.tagCompletionDismissed = false;
    },

    activeFilters: {
      deep: true,
      handler() {
        this.resetVisibleTopics();
      },
    },

    sortMethod() {
      this.resetVisibleTopics();
    },

    hideSeen(val) {
      persistUiPreferences({ ...loadUiPreferences(), hideSeen: val });
      this.resetVisibleTopics();
    },

    hideBadDeals(val) {
      persistUiPreferences({ ...loadUiPreferences(), hideBadDeals: val });
      this.resetVisibleTopics();
    },

    hiddenMerchants(val) {
      persistUiPreferences({ ...loadUiPreferences(), hiddenMerchants: val });
      this.resetVisibleTopics();
    },
  },

  computed: {
    filteredTopics() {
      const base = getFilteredSortedTopics(this.topics, this.activeFilters, this.sortMethod, this.hiddenMerchants);
      if (!this.hideSeen && !this.hideBadDeals) return base;
      // Access seen.value so Vue tracks reactivity
      const seenMap = this.seen;
      return base.filter(t => {
        if (this.hideSeen && seenMap.has(String(t.topic_id))) return false;
        if (this.hideBadDeals && Number(t.score) < -5) return false;
        return true;
      });
    },

    merchantOptions() {
      return getMerchantOptions(this.topics);
    },

    filteredMerchantOptions() {
      const query = this.merchantFilterInput.trim().toLowerCase();
      if (!query) return this.merchantOptions;
      return this.merchantOptions.filter(({ name }) => name.toLowerCase().includes(query));
    },

    hiddenMerchantsNotInFeed() {
      const availableKeys = new Set(this.merchantOptions.map(({ key }) => key));
      return this.hiddenMerchants.filter((name) => !availableKeys.has(name.trim().toLowerCase()));
    },

    mobileHiddenMerchantOptions() {
      const optionsByKey = new Map(this.merchantOptions.map((option) => [option.key, option]));
      const query = this.mobileMerchantSearch.trim().toLowerCase();
      return this.hiddenMerchants
        .map((name) => {
          const key = name.trim().toLowerCase();
          return optionsByKey.get(key) ?? { key, name, count: null };
        })
        .filter(({ name }) => !query || name.toLowerCase().includes(query));
    },

    mobileVisibleMerchantOptions() {
      const query = this.mobileMerchantSearch.trim().toLowerCase();
      return this.merchantOptions.filter(({ name }) => (
        !this.isMerchantHidden(name) && (!query || name.toLowerCase().includes(query))
      ));
    },

    displayedTopics() {
      return this.filteredTopics.slice(0, this.visibleTopicCount);
    },

    hasMoreDisplayedTopics() {
      return this.visibleTopicCount < this.filteredTopics.length;
    },

    isRegexError() {
      return parseFilterTerm(this.filterInput).isRegexError;
    },

    tagSuggestions() {
      if (this.tagCompletionDismissed) return [];
      return suggestTagTerms(this.filterInput, this.tagVocabulary);
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
      // Always escape HTML entities first to prevent XSS from external API data
      const escapeHtml = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      let result = escapeHtml(text);

      if (!this.activeFilters || this.activeFilters.length === 0) return result;

      for (const filter of this.activeFilters) {
        const { regex, literal, isRegexError } = parseFilterTerm(filter);
        if (regex && !isRegexError) {
          // Use a version of the regex with the global flag for replace
          const globalRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
          result = result.replace(globalRegex, (match) => `<mark>${match}</mark>`);
        } else {
          // Plain literal: escape the filter term too so e.g. "H&M" matches "H&amp;M" in escaped text
          const escapedLiteral = escapeHtml(literal);
          const lowerText = result.toLowerCase();
          const lowerFilter = escapedLiteral.toLowerCase();
          if (lowerFilter && lowerText.includes(lowerFilter)) {
            const escapedForRegex = escapedLiteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const substringRegex = new RegExp(escapedForRegex, "ig");
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
      this.resolvedTheme = theme;
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
      this.loadMoreTopicsIfNearBottom();
    },

    handleScroll() {
      this.loadMoreTopicsIfNearBottom();
    },

    resetVisibleTopics() {
      this.visibleTopicCount = TOPICS_BATCH_SIZE;
      this.$nextTick(() => this.loadMoreTopicsIfNearBottom());
    },

    loadMoreTopicsIfNearBottom() {
      if (!this.hasMoreDisplayedTopics) return;

      const scrollBottom = window.innerHeight + window.scrollY;
      const pageBottom = document.documentElement.offsetHeight;
      if (pageBottom - scrollBottom <= INFINITE_SCROLL_THRESHOLD_PX) {
        this.visibleTopicCount += TOPICS_BATCH_SIZE;
      }
    },

    handleKeyDown(event) {
      if (event.key === "Tab" && this.mobileMerchantSheetOpen) {
        this.trapMobileMerchantFocus(event);
        return;
      }

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

      if (event.key === "Escape" && this.mobileMerchantSheetOpen) {
        event.preventDefault();
        this.closeMobileMerchantSheet();
        return;
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

      if (event.key === "h" && !isInput) {
        event.preventDefault();
        this.hideSeen = !this.hideSeen;
      }

      if (event.key === "m" && !isInput) {
        event.preventDefault();
        this.handleMarkAllSeen();
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

    updateUrl() {
      const query = {};
      if (this.activeFilters.length > 0) {
        query.filters = JSON.stringify(this.activeFilters);
      }
      if (this.sortBySetByUser) {
        query.sort = this.sortMethod;
      }
      this.$router.replace({ path: "/", query });
    },

    // Enter accepts the highlighted suggestion when there is one; otherwise it
    // applies the filter exactly as typed, preserving the pre-completion behavior.
    onFilterEnter(event) {
      if (event.isComposing) return;
      const highlighted = this.tagSuggestions[this.tagSuggestionIndex];
      if (highlighted) {
        this.acceptTagSuggestion(highlighted);
      } else {
        this.applyFilter();
      }
    },

    // Tab completes the top suggestion even when nothing is highlighted.
    onFilterTab(event) {
      const term = this.tagSuggestions[this.tagSuggestionIndex] ?? this.tagSuggestions[0];
      if (!term) return;
      event.preventDefault();
      this.acceptTagSuggestion(term);
    },

    onFilterEscape(event) {
      if (this.tagSuggestions.length) {
        // Consumed by the dropdown; don't let the window handler see it too.
        event.stopPropagation();
        this.tagCompletionDismissed = true;
      } else {
        this.$refs.filterInput.blur();
      }
    },

    moveTagSuggestion(delta, event) {
      const count = this.tagSuggestions.length;
      if (!count) return;
      event.preventDefault();
      this.tagSuggestionIndex = (this.tagSuggestionIndex + delta + count) % count;
      this.$nextTick(() => {
        this.$el.querySelector(".tag-suggestion--highlighted")?.scrollIntoView({ block: "nearest" });
      });
    },

    acceptTagSuggestion(term) {
      this.filterInput = term;
      this.$nextTick(() => {
        const input = this.$refs.filterInput;
        if (!input) return;
        input.focus();
        input.setSelectionRange(term.length, term.length);
      });
    },

    onFilterBlur() {
      this.tagCompletionDismissed = true;
    },

    onFilterFocus() {
      this.tagCompletionDismissed = false;
    },

    applyFilter() {
      const trimmed = this.filterInput.trim();
      if (trimmed && !this.activeFilters.includes(trimmed)) {
        this.activeFilters.push(trimmed);
        this.filterInput = "";
        this.$refs.filterInput.blur();
        this.updateUrl();
      }
    },

    clearFilter(index) {
      this.activeFilters.splice(index, 1);
      this.updateUrl();
    },

    clearAllFilters() {
      this.activeFilters = [];
      this.filterInput = "";
      this.updateUrl();
    },

    filterByDealer(dealerName) {
      const trimmed = dealerName.trim();
      if (trimmed && !this.activeFilters.includes(trimmed)) {
        this.activeFilters.push(trimmed);
        this.updateUrl();
      }
      this.filterInput = "";
      this.$nextTick(() => {
        const input = this.$refs.filterInput;
        if (input) {
          input.scrollIntoView({ behavior: "smooth", block: "nearest" });
          input.focus();
        }
      });
    },

    visibleTags,

    filterByTag(tag) {
      const term = tagFilterTerm(tag);
      if (!this.activeFilters.includes(term)) {
        this.activeFilters.push(term);
        this.updateUrl();
      }
    },

    fetchDeals() {
      this.isLoading = true;
      const minLoadingTime = new Promise(resolve => setTimeout(resolve, 500));

      Promise.all([
        axios.get(`/topics.json?_=${Date.now()}`, {
          headers: { "cache-control": "no-cache" },
        }),
        // Tags are optional garnish: a failure here must not cost us the deals.
        axios.get(`/enrichment.json?_=${Date.now()}`, {
          headers: { "cache-control": "no-cache" },
        }).catch(() => ({ data: null })),
        minLoadingTime
      ])
        .then(([response, enrichment]) => {
          this.topics = attachTags(response.data, enrichment.data);
          this.tagVocabulary = Array.isArray(enrichment.data?.vocabulary) ? enrichment.data.vocabulary : [];
          this.resetVisibleTopics();
        })
        .catch((err) => {
          console.error("Failed to fetch deals:", err.response || err);
        })
        .finally(() => {
          this.isLoading = false;
        });
    },

    initializeSortMethod() {
      const urlSort = new URLSearchParams(window.location.search).get("sort");
      if (urlSort && SORT_METHOD_KEYS.includes(urlSort)) {
        this.sortMethod = urlSort;
        this.sortBySetByUser = true;
      } else {
        this.sortMethod = loadUiPreferences().sortMethod;
      }
    },

    setSortMethod(method) {
      this.sortMethod = method;
      this.sortBySetByUser = true;
      this.sortDropdownOpen = false;
      persistUiPreferences({ ...loadUiPreferences(), sortMethod: method });
      this.updateUrl();
    },

    toggleSeenDropdown() {
      this.seenDropdownOpen = !this.seenDropdownOpen;
    },

    toggleMerchantDropdown() {
      this.merchantDropdownOpen = !this.merchantDropdownOpen;
    },

    isMerchantHidden(merchantName) {
      const key = merchantName.trim().toLowerCase();
      return this.hiddenMerchants.some((name) => name.trim().toLowerCase() === key);
    },

    setMerchantHidden(merchantName, hidden) {
      const name = merchantName.trim();
      const key = name.toLowerCase();
      if (!name) return;
      if (hidden) {
        if (!this.hiddenMerchants.some((existing) => existing.trim().toLowerCase() === key)) {
          this.hiddenMerchants = [name, ...this.hiddenMerchants];
          this.$nextTick(() => {
            if (this.mobileMerchantSheetOpen) {
              this.$refs.mobileMerchantSheetPanel
                ?.querySelector(".mobile-merchant-option--hidden")
                ?.focus();
            }
          });
        }
      } else {
        this.hiddenMerchants = this.hiddenMerchants.filter((existing) => existing.trim().toLowerCase() !== key);
      }
    },

    clearHiddenMerchants() {
      this.hiddenMerchants = [];
    },

    openMobileMerchantSheet() {
      this.closeMenu();
      this.mobileMerchantBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      this.mobileMerchantSheetOpen = true;
      this.$nextTick(() => this.$refs.mobileMerchantSearch?.focus());
    },

    closeMobileMerchantSheet() {
      this.mobileMerchantSheetOpen = false;
      this.mobileMerchantSearch = "";
      this.restoreMobileMerchantScroll();
      this.$nextTick(() => this.$refs.mobileMenuButton?.focus());
    },

    restoreMobileMerchantScroll() {
      if (this.mobileMerchantBodyOverflow === null) return;
      document.body.style.overflow = this.mobileMerchantBodyOverflow;
      this.mobileMerchantBodyOverflow = null;
    },

    trapMobileMerchantFocus(event) {
      const focusable = [...this.$refs.mobileMerchantSheetPanel.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
      if (this.seenDropdownOpen && !event.target.closest('.seen-dropdown-wrapper')) {
        this.seenDropdownOpen = false;
      }
      if (this.merchantDropdownOpen && !event.target.closest('.merchant-dropdown-wrapper')) {
        this.merchantDropdownOpen = false;
      }
    },

    getDealerColor(dealerName) {
      if (!dealerName) return null;
      const colors = this.resolvedTheme === 'dark' ? DEALER_COLORS_DARK : DEALER_COLORS;
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

    isHotDeal(topic) {
      const score = Number(topic.score) || 0;
      if (score < 15) return false;

      const postedAt = dayjs(topic.post_time);
      if (!postedAt.isValid()) return false;

      const ageHours = Math.max(dayjs().diff(postedAt, "hour", true), 1);
      const hotness = score / Math.pow(ageHours + 2, 0.6);
      return hotness >= 5;
    },

    toggleInfoOverlay() {
      this.infoOverlayVisible = !this.infoOverlayVisible;
    },

    onDealClick(topic) {
      this.markSeen(topic.topic_id);
    },

    handleMarkAllSeen() {
      this.markAllSeen(this.displayedTopics);
    },

    handleClearSeen() {
      this.clearSeen();
    },

    exportSettings() {
      const blob = new Blob([exportLocalStorageSettings()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "rfd-fyi-settings.json";
      link.click();
      URL.revokeObjectURL(url);
    },

    async importSettings(file) {
      if (!importLocalStorageSettings(await file.text())) {
        window.alert("That file is not a valid rfd-fyi settings export.");
        return;
      }

      const preferences = loadUiPreferences();
      this.sortMethod = preferences.sortMethod;
      this.hideSeen = preferences.hideSeen;
      this.hideBadDeals = preferences.hideBadDeals;
      this.hiddenMerchants = preferences.hiddenMerchants;
      this.applyTheme(preferences.theme, true);
      this.reloadSeenDeals();
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
            <div
              class="filter-container"
              :class="{ 'has-active-filters': activeFilters.length > 0 }"
            >
              <span
                v-for="(filter, index) in activeFilters"
                :key="index"
                class="filter-tag"
              >
                {{ filter }}
                <button
                  class="filter-tag-clear"
                  @click="clearFilter(index)"
                  title="Clear filter"
                >
                  <span class="material-symbols-outlined">close</span>
                </button>
              </span>
              <input
                ref="filterInput"
                v-model="filterInput"
                type="text"
                placeholder="filter"
                class="search-input"
                :class="{ 'search-input--regex-error': isRegexError }"
                :title="isRegexError ? 'Invalid regex' : ''"
                @keydown.enter="onFilterEnter"
                @keydown.tab="onFilterTab"
                @keydown.esc="onFilterEscape"
                @keydown.down="moveTagSuggestion(1, $event)"
                @keydown.up="moveTagSuggestion(-1, $event)"
                @blur="onFilterBlur"
                @focus="onFilterFocus"
              />
            </div>
            <!-- mousedown.prevent keeps the input focused so the click lands -->
            <ul
              v-if="tagSuggestions.length"
              class="tag-suggestions"
              role="listbox"
              @mousedown.prevent
            >
              <li
                v-for="(suggestion, i) in tagSuggestions"
                :key="suggestion"
                role="option"
                :aria-selected="i === tagSuggestionIndex"
              >
                <button
                  type="button"
                  tabindex="-1"
                  class="tag-suggestion"
                  :class="{
                    'tag-suggestion--highlighted': i === tagSuggestionIndex,
                  }"
                  @mouseenter="tagSuggestionIndex = i"
                  @click="acceptTagSuggestion(suggestion)"
                >
                  {{ suggestion }}
                </button>
              </li>
            </ul>
          </div>
          <!-- Desktop buttons -->
          <button
            class="icon-button desktop-only"
            title="Refresh deals"
            @click="fetchDeals"
            :disabled="isLoading"
          >
            <span
              class="material-symbols-outlined"
              :class="{ spinning: isLoading }"
              >refresh</span
            >
          </button>
          <div class="seen-dropdown-wrapper desktop-only">
            <button
              class="icon-button"
              :class="{ active: hideSeen || hideBadDeals }"
              title="Visibility"
              @click="toggleSeenDropdown"
            >
              <span class="material-symbols-outlined">{{
                hideSeen || hideBadDeals ? "visibility_off" : "visibility"
              }}</span>
            </button>
            <div class="seen-dropdown" v-if="seenDropdownOpen" @click.stop>
              <button
                class="dropdown-item"
                :class="{ active: hideSeen }"
                @click="
                  hideSeen = !hideSeen;
                  seenDropdownOpen = false;
                "
              >
                <span class="material-symbols-outlined">{{
                  hideSeen ? "visibility" : "visibility_off"
                }}</span>
                <span>{{ hideSeen ? "Show seen" : "Hide seen" }}</span>
              </button>
              <button
                class="dropdown-item"
                :class="{ active: hideBadDeals }"
                @click="
                  hideBadDeals = !hideBadDeals;
                  seenDropdownOpen = false;
                "
              >
                <span class="material-symbols-outlined">thumb_down</span>
                <span>{{
                  hideBadDeals ? "Show bad deals" : "Hide bad deals"
                }}</span>
              </button>
              <button
                class="dropdown-item"
                @click="
                  handleMarkAllSeen();
                  seenDropdownOpen = false;
                "
              >
                <span class="material-symbols-outlined">done_all</span>
                <span>Mark all seen</span>
              </button>
              <button
                class="dropdown-item"
                @click="
                  handleClearSeen();
                  seenDropdownOpen = false;
                "
                :disabled="seen.size === 0"
              >
                <span class="material-symbols-outlined">ink_eraser</span>
                <span>Clear seen</span>
              </button>
            </div>
          </div>
          <div class="merchant-dropdown-wrapper desktop-only">
            <button
              class="icon-button"
              :class="{ active: hiddenMerchants.length > 0 }"
              :title="`Merchants${hiddenMerchants.length ? ` (${hiddenMerchants.length} hidden)` : ''}`"
              :aria-expanded="merchantDropdownOpen"
              @click="toggleMerchantDropdown"
            >
              <span class="material-symbols-outlined">storefront</span>
            </button>
            <div
              v-if="merchantDropdownOpen"
              class="merchant-dropdown"
              @click.stop
            >
              <div class="merchant-dropdown-header">
                <strong>Merchants</strong>
                <button
                  class="merchant-reset"
                  :disabled="hiddenMerchants.length === 0"
                  @click="clearHiddenMerchants"
                >
                  Show all
                </button>
              </div>
              <input
                v-model="merchantFilterInput"
                class="merchant-search"
                type="search"
                placeholder="Search merchants"
                aria-label="Search merchants"
              />
              <div class="merchant-options">
                <label
                  v-for="merchant in filteredMerchantOptions"
                  :key="merchant.key"
                  class="merchant-option"
                >
                  <input
                    type="checkbox"
                    :checked="!isMerchantHidden(merchant.name)"
                    @change="
                      setMerchantHidden(merchant.name, !$event.target.checked)
                    "
                  />
                  <span>{{ merchant.name }}</span>
                  <small>{{ merchant.count }}</small>
                </label>
                <p
                  v-if="filteredMerchantOptions.length === 0"
                  class="merchant-empty"
                >
                  No merchants match.
                </p>
              </div>
              <div
                v-if="hiddenMerchantsNotInFeed.length"
                class="merchant-missing"
              >
                <span>Hidden outside this feed</span>
                <button
                  v-for="merchant in hiddenMerchantsNotInFeed"
                  :key="merchant"
                  @click="setMerchantHidden(merchant, false)"
                >
                  {{ merchant }} <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
          </div>
          <div class="sort-dropdown-wrapper desktop-only">
            <button
              class="icon-button"
              :title="'Sort: ' + currentSortOption.label"
              @click="toggleSortDropdown"
            >
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
          <button
            class="icon-button desktop-only"
            :title="themeTitle"
            @click="toggleTheme"
          >
            <span class="material-symbols-outlined">{{ themeIcon }}</span>
          </button>
          <button
            class="icon-button desktop-only"
            title="Info"
            @click="toggleInfoOverlay"
          >
            <span class="material-symbols-outlined">info</span>
          </button>
          <div class="mobile-menu-wrapper mobile-only">
            <button ref="mobileMenuButton" class="icon-button" title="Menu" @click="toggleMenu">
              <span class="material-symbols-outlined">{{
                menuOpen ? "close" : "menu"
              }}</span>
            </button>
            <div class="mobile-dropdown" v-if="menuOpen" @click.stop>
              <button
                class="dropdown-item"
                @click="handleMenuAction(fetchDeals)"
                :disabled="isLoading"
              >
                <span
                  class="material-symbols-outlined"
                  :class="{ spinning: isLoading }"
                  >refresh</span
                >
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
              <div class="dropdown-section-label">Visibility</div>
              <button
                class="dropdown-item"
                :class="{ active: hideSeen }"
                @click="
                  handleMenuAction(() => {
                    hideSeen = !hideSeen;
                  })
                "
              >
                <span class="material-symbols-outlined">{{
                  hideSeen ? "visibility" : "visibility_off"
                }}</span>
                <span>{{ hideSeen ? "Show seen" : "Hide seen" }}</span>
              </button>
              <button
                class="dropdown-item"
                :class="{ active: hideBadDeals }"
                @click="
                  handleMenuAction(() => {
                    hideBadDeals = !hideBadDeals;
                  })
                "
              >
                <span class="material-symbols-outlined">thumb_down</span>
                <span>{{
                  hideBadDeals ? "Show bad deals" : "Hide bad deals"
                }}</span>
              </button>
              <button
                class="dropdown-item"
                @click="handleMenuAction(handleMarkAllSeen)"
              >
                <span class="material-symbols-outlined">done_all</span>
                <span>Mark all seen</span>
              </button>
              <button
                class="dropdown-item"
                @click="handleMenuAction(handleClearSeen)"
                :disabled="seen.size === 0"
              >
                <span class="material-symbols-outlined">ink_eraser</span>
                <span>Clear seen</span>
              </button>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item" @click="openMobileMerchantSheet">
                <span class="material-symbols-outlined">storefront</span>
                <span>Merchants</span>
                <span v-if="hiddenMerchants.length">({{ hiddenMerchants.length }} hidden)</span>
              </button>
              <div class="dropdown-divider"></div>
              <button
                class="dropdown-item"
                @click="handleMenuAction(toggleInfoOverlay)"
              >
                <span class="material-symbols-outlined">info</span>
                <span>Info</span>
              </button>
              <button
                class="dropdown-item"
                @click="handleMenuAction(toggleTheme)"
              >
                <span class="material-symbols-outlined">{{ themeIcon }}</span>
                <span>{{ themeTitle.split("(")[0].trim() }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="isLoading && topics.length === 0" class="loading-container">
        <span class="material-symbols-outlined spinning loading-spinner"
          >refresh</span
        >
        <p>Loading deals...</p>
      </div>
      <div class="cards-wrapper" v-else>
        <div v-if="isLoading" class="loading-overlay">
          <span class="material-symbols-outlined spinning loading-spinner"
            >refresh</span
          >
        </div>
        <div class="list-view">
          <div v-if="filteredTopics.length === 0" class="empty-state">
            <span class="material-symbols-outlined">search_off</span>
            <p>No deals match your filters.</p>
            <button
              v-if="activeFilters.length > 0"
              class="empty-state-button"
              @click="clearAllFilters"
            >
              Clear filters
            </button>
          </div>
          <template v-else>
            <div
              v-for="topic in displayedTopics"
              :key="topic.topic_id"
              class="deal-row"
              :class="{
                'deal-row--seen': seen.has(String(topic.topic_id)),
                'deal-row--hot': isHotDeal(topic),
              }"
              @click.capture="onDealClick(topic)"
            >
              <div class="card-header">
                <div class="title-with-link">
                  <span class="deal-text">
                    <span
                      v-if="isHotDeal(topic)"
                      class="hot-deal-icon"
                      title="Hot deal"
                      aria-label="Hot deal"
                      >🔥</span
                    >
                    <button
                      v-if="topic.Offer.dealer_name"
                      class="dealer-name dealer-label dealer-label--clickable"
                      :style="getDealerStyle(topic.Offer.dealer_name)"
                      :title="`Filter by ${topic.Offer.dealer_name}`"
                      @click="filterByDealer(topic.Offer.dealer_name)"
                      v-html="highlightText(topic.Offer.dealer_name)"
                    ></button
                    ><span
                      v-if="topic.Offer.dealer_name"
                      class="dealer-title-gap"
                      aria-hidden="true"
                    ></span>
                    <a
                      :href="`https://forums.redflagdeals.com${topic.web_path}`"
                      target="_blank"
                      class="deal-title"
                      v-html="highlightText(topic.title)"
                    ></a
                    ><span
                      v-if="visibleTags(topic.tags).length"
                      class="tag-chips"
                    >
                      <button
                        v-for="tag in visibleTags(topic.tags)"
                        :key="tag"
                        class="tag-chip"
                        :title="`Filter by ${tag}`"
                        @click.stop="filterByTag(tag)"
                      >
                        {{ tag }}
                      </button>
                    </span>
                  </span>
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
              <div class="row-stats">
                <span class="stat-compact"
                  >{{ formatDate(topic.post_time) }} -
                  {{ formatDate(topic.last_post_time) }}</span
                >
              </div>
            </div>
            <div v-if="hasMoreDisplayedTopics" class="load-more-status">
              Showing {{ displayedTopics.length }} of
              {{ filteredTopics.length }} deals. Scroll for more.
            </div>
          </template>
        </div>
      </div>
    </div>
    <InfoOverlay
      :visible="infoOverlayVisible"
      @close="toggleInfoOverlay"
      @export-settings="exportSettings"
      @import-settings="importSettings"
    />
    <div
      v-if="mobileMerchantSheetOpen"
      class="mobile-merchant-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-merchant-sheet-title"
      @click.self="closeMobileMerchantSheet"
    >
      <section ref="mobileMerchantSheetPanel" class="mobile-merchant-sheet-panel">
        <header class="mobile-merchant-sheet-header">
          <h2 id="mobile-merchant-sheet-title">Merchants</h2>
          <button class="mobile-merchant-sheet-close" aria-label="Close merchants" @click="closeMobileMerchantSheet">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <div class="mobile-merchant-sheet-controls">
          <input
            ref="mobileMerchantSearch"
            v-model="mobileMerchantSearch"
            class="merchant-search"
            type="search"
            placeholder="Search merchants"
            aria-label="Search merchants"
          />
          <button class="merchant-reset" :disabled="hiddenMerchants.length === 0" @click="clearHiddenMerchants">Show all</button>
        </div>
        <div class="mobile-merchant-sheet-results">
          <section v-if="mobileHiddenMerchantOptions.length" aria-labelledby="hidden-merchants-title">
            <h3 id="hidden-merchants-title">Hidden</h3>
            <button
              v-for="merchant in mobileHiddenMerchantOptions"
              :key="merchant.key"
              class="mobile-merchant-option mobile-merchant-option--hidden"
              @click="setMerchantHidden(merchant.name, false)"
            >
              <span>{{ merchant.name }}</span>
              <small>{{ merchant.count ?? "Not in feed" }}</small>
              <strong>Restore</strong>
            </button>
          </section>
          <section v-if="mobileVisibleMerchantOptions.length" aria-labelledby="visible-merchants-title">
            <h3 id="visible-merchants-title">Visible</h3>
            <button
              v-for="merchant in mobileVisibleMerchantOptions"
              :key="merchant.key"
              class="mobile-merchant-option"
              @click="setMerchantHidden(merchant.name, true)"
            >
              <span>{{ merchant.name }}</span>
              <small>{{ merchant.count }}</small>
              <strong>Hide</strong>
            </button>
          </section>
          <p v-if="!mobileHiddenMerchantOptions.length && !mobileVisibleMerchantOptions.length" class="merchant-empty">No merchants match.</p>
        </div>
      </section>
    </div>
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
  border-radius: 14px;
  box-shadow: 0 6px 20px var(--shadow-medium);
  min-width: 10.625rem;
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
  border-radius: 16px;
}

.loading-overlay .loading-spinner {
  font-size: 3rem;
  color: var(--text-primary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 20px;
  border: 1px dashed var(--border-color-light);
  border-radius: 16px;
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  text-align: center;
}

.empty-state .material-symbols-outlined {
  font-size: 2.25rem;
}

.empty-state p {
  margin: 0;
  color: var(--text-primary);
  font-weight: 600;
}

.empty-state-button {
  padding: 8px 12px;
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  background-color: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 0.8125rem;
  transition: all 0.2s ease;
}

.empty-state-button:hover {
  border-color: color-mix(
    in srgb,
    var(--accent) 32%,
    var(--border-color-hover)
  );
  color: var(--accent);
}

.load-more-status {
  padding: 16px;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  text-align: center;
}

/* ============================================
   Filter Wrapper & Regex UI
   ============================================ */

.filter-wrapper {
  flex: 1;
  max-width: 31.25rem;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* Anchors the tag-completion dropdown */
  position: relative;
}

.tag-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color-light);
  border-radius: 14px;
  box-shadow: 0 6px 20px var(--shadow-medium);
  max-height: 16rem;
  overflow-y: auto;
  z-index: 100;
}

.tag-suggestion {
  display: block;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}

.tag-suggestion--highlighted {
  background-color: var(--accent-subtle);
  color: var(--accent);
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

.dealer-label--clickable {
  /* reset button chrome */
  appearance: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  /* subtle interactive cue */
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  transition:
    opacity 0.15s ease,
    box-shadow 0.15s ease;
}

.dealer-label--clickable:hover,
.dealer-label--clickable:focus-visible {
  opacity: 0.8;
  box-shadow: 0 0 0 2px currentColor;
  outline: none;
}

/* ============================================
   Tag chips
   ============================================ */

/* Chips sit inline after the title, not in .row-stats — putting them beside the
   dates threw the date column out of alignment across rows. */
.tag-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: 8px;
  vertical-align: baseline;
}

.tag-chip {
  appearance: none;
  padding: 1px 8px;
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  background-color: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 0.6875rem;
  line-height: 1.5;
  letter-spacing: 0.02em;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}

.tag-chip:hover,
.tag-chip:focus-visible {
  border-color: color-mix(
    in srgb,
    var(--accent) 40%,
    var(--border-color-hover)
  );
  color: var(--accent);
  outline: none;
}

.merchant-dropdown-wrapper,
.seen-dropdown-wrapper {
  position: relative;
}

.merchant-dropdown {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color-light);
  border-radius: 14px;
  box-shadow: 0 6px 20px var(--shadow-medium);
  color: var(--text-primary);
  min-width: 17rem;
  overflow: hidden;
}

.merchant-dropdown-wrapper .merchant-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 100;
}

.merchant-dropdown-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  padding: 10px 12px 6px;
}

.merchant-reset {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  padding: 2px 4px;
}

.merchant-reset:disabled {
  color: var(--text-secondary);
  cursor: default;
}

.merchant-search {
  background: var(--bg-input);
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  box-sizing: border-box;
  color: var(--text-primary);
  font: inherit;
  margin: 4px 12px 8px;
  padding: 7px 8px;
  width: calc(100% - 24px);
}

.merchant-options {
  max-height: 16rem;
  overflow-y: auto;
}

.merchant-option {
  align-items: center;
  cursor: pointer;
  display: flex;
  gap: 8px;
  padding: 7px 12px;
}

.merchant-option:hover {
  background: var(--accent-subtle);
}

.merchant-option span {
  flex: 1;
}

.merchant-option small {
  color: var(--text-secondary);
}

.merchant-empty {
  color: var(--text-secondary);
  margin: 0;
  padding: 10px 12px;
}

.merchant-missing {
  border-top: 1px solid var(--border-color-light);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
}

.merchant-missing > span {
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.merchant-missing button {
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  padding: 2px 0;
  text-align: left;
}

.mobile-merchant-sheet {
  align-items: stretch;
  background: var(--bg-primary);
  display: flex;
  inset: 0;
  min-height: 100dvh;
  position: fixed;
  z-index: 1000;
}

.mobile-merchant-sheet-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 100dvh;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}

.mobile-merchant-sheet-header,
.mobile-merchant-sheet-controls {
  align-items: center;
  display: flex;
  gap: 12px;
  padding: 12px 16px;
}

.mobile-merchant-sheet-header {
  border-bottom: 1px solid var(--border-color-light);
  justify-content: space-between;
}

.mobile-merchant-sheet-header h2,
.mobile-merchant-sheet-results h3 {
  margin: 0;
}

.mobile-merchant-sheet-header h2 {
  font-size: 1.125rem;
}

.mobile-merchant-sheet-close {
  align-items: center;
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  justify-content: center;
  min-height: 44px;
  min-width: 44px;
  padding: 0;
}

.mobile-merchant-sheet-controls {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color-light);
}

.mobile-merchant-sheet-controls .merchant-search {
  flex: 1;
  margin: 0;
  min-height: 44px;
  width: auto;
}

.mobile-merchant-sheet-controls .merchant-reset {
  min-height: 44px;
  white-space: nowrap;
}

.mobile-merchant-sheet-results {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 0;
}

.mobile-merchant-sheet-results section + section {
  border-top: 1px solid var(--border-color-light);
  margin-top: 8px;
  padding-top: 8px;
}

.mobile-merchant-sheet-results h3 {
  color: var(--text-secondary);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  padding: 8px 16px;
  text-transform: uppercase;
}

.mobile-merchant-option {
  align-items: center;
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) auto auto;
  min-height: 52px;
  padding: 8px 16px;
  text-align: left;
  width: 100%;
}

.mobile-merchant-option:active {
  background: var(--accent-subtle);
}

.mobile-merchant-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-merchant-option small {
  color: var(--text-secondary);
}

.mobile-merchant-option strong {
  color: var(--accent);
  font-size: 0.8125rem;
}

.mobile-merchant-option--hidden {
  background: var(--accent-subtle);
}

.seen-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color-light);
  border-radius: 14px;
  box-shadow: 0 6px 20px var(--shadow-medium);
  min-width: 10.625rem;
  z-index: 100;
  overflow: hidden;
}

/* Active state for the eye icon button when hide-seen is on */
.icon-button.active {
  color: var(--accent);
}

.deal-row--seen {
  opacity: 0.4;
  transition: opacity 0.2s ease;
}

.deal-row--seen:hover,
.deal-row--seen:focus-within {
  opacity: 1;
}
</style>
