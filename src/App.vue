<script>
import dayjs from "dayjs";
import { markRaw } from "vue";
import { fetchJson, isUnchangedPayload, NOT_MODIFIED } from "./fetchJson.js";
import utc from "dayjs/plugin/utc";

import { attachTags, tagFilterTerm, tagSuggestions as suggestTagTerms } from "./enrichment.js";
import { createHighlighter, getFilteredSortedTopics, getMerchantOptions, parseFilterTerm } from "./filterTopics.js";
import { loadUiPreferences, persistUiPreferences, SORT_METHOD_KEYS } from "./preferences.js";
import { exportLocalStorageSettings, importLocalStorageSettings } from "./settingsTransfer.js";
import { seen, markSeen, markUnseen, isSeen, markAllSeen, clearSeen, reloadSeenDeals } from "./composables/useSeenDeals.js";
import DealRow from "./components/DealRow.vue";
import FilterBar from "./components/FilterBar.vue";
import InfoOverlay from "./components/InfoOverlay.vue";
import MerchantSheet from "./components/MerchantSheet.vue";
import SettingsPanel from "./components/SettingsPanel.vue";

import "./theme.css";

dayjs.extend(utc);

const TOPICS_BATCH_SIZE = 100;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const INFINITE_SCROLL_THRESHOLD_PX = 600;
// Scores at or below this mark a deal as "bad" for the hide-bad-deals filter.
const BAD_DEAL_SCORE_THRESHOLD = -5;

function normalizeUrlFilters(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((filter) => typeof filter === "string" && filter.trim() !== "");
}

export default {
  components: {
    DealRow,
    FilterBar,
    InfoOverlay,
    MerchantSheet,
    SettingsPanel,
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
      rawTopics: [],
      enrichment: null,
      pendingTopics: null,
      pendingEnrichment: null,
      refreshController: null,
      lastCheckedAt: null,
      readingAnchors: null,
      isMobile: false,
      currentTheme: "auto",
      resolvedTheme: "light",
      darkModeQuery: null,
      themeChangeHandler: null,
      isLoading: false,
      loadError: "",
      lastSuccessfulRefresh: null,
      refreshDegraded: false,
      menuOpen: false,
      infoOverlayVisible: false,
      settingsPanelVisible: false,
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
      isBackgroundLoading: false,
      lastTopicsEtag: null,
      lastEnrichmentEtag: null,
    };
  },

  mounted() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("scroll", this.handleScroll, { passive: true });
    window.addEventListener("click", this.handleClickOutside);
    this.detectMobile();
    this.fetchDeals();
    document.addEventListener("visibilitychange", this.refreshIfStale);
    this.refreshIntervalId = window.setInterval(() => {
      if (!document.hidden && !this.isLoading) this.fetchDeals({ background: true });
    }, REFRESH_INTERVAL_MS);
    this.initializeSortMethod();
    this.initializeTheme();
    this.setupThemeListener();
  },

  beforeUnmount() {
    this.refreshController?.abort();
    document.removeEventListener("visibilitychange", this.refreshIfStale);
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
    parsedFilters() {
      return this.activeFilters.map(parseFilterTerm);
    },

    highlightText() {
      return createHighlighter(this.parsedFilters);
    },

    pendingNewCount() {
      const existing = new Set(this.rawTopics.map(topic => topic.topic_id));
      return (this.pendingTopics ?? []).filter(topic => !existing.has(topic.topic_id)).length;
    },

    filteredTopics() {
      const base = getFilteredSortedTopics(this.topics, this.activeFilters, this.sortMethod, this.hiddenMerchants, this.parsedFilters);
      if (!this.hideSeen && !this.hideBadDeals) return base;
      // Access seen.value so Vue tracks reactivity
      const seenMap = this.seen;
      return base.filter(t => {
        if (this.hideSeen && seenMap.has(String(t.topic_id))) return false;
        if (this.hideBadDeals && Number(t.score) < BAD_DEAL_SCORE_THRESHOLD) return false;
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

    feedStatusText() {
      if (!this.lastSuccessfulRefresh) return "";
      const updated = dayjs(this.lastSuccessfulRefresh);
      if (!updated.isValid()) return "";
      return `Last updated ${updated.format("YYYY-MM-DD hh:mm A")}`;
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
        this.$refs.filterBar?.focusInput();
      }

      if (event.key === "r" && !isInput) {
        event.preventDefault();
        this.fetchDeals();
      }

      if (event.key === "i" && !isInput) {
        event.preventDefault();
        this.toggleInfoOverlay();
      }

      if (event.key === "g" && !isInput) {
        event.preventDefault();
        this.toggleSettingsPanel();
      }

      if (event.key === "Escape" && this.settingsPanelVisible) {
        event.preventDefault();
        this.toggleSettingsPanel();
        return;
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
          return normalizeUrlFilters(parsed);
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
          return normalizeUrlFilters(parsed);
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
      const search = new URLSearchParams(query).toString();
      const path = window.location.pathname;
      window.history.replaceState({}, "", search ? `${path}?${search}` : path);
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
        this.$refs.filterBar?.blurInput();
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
        this.$refs.filterBar?.focusInput();
        this.$refs.filterBar?.moveCursorToEnd();
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
        this.$refs.filterBar?.blurInput();
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
        this.$refs.filterBar?.focusAndScrollIntoView();
      });
    },

    filterByTag(tag) {
      const term = tagFilterTerm(tag);
      if (!this.activeFilters.includes(term)) {
        this.activeFilters.push(term);
        this.updateUrl();
      }
    },

    refreshIfStale() {
      if (document.hidden || this.isLoading) return;
      if (this.lastCheckedAt === null || Date.now() - this.lastCheckedAt >= REFRESH_INTERVAL_MS) {
        this.fetchDeals({ background: true });
      }
    },

    // Batch topic/tag patches into one correction. If a deal disappears, keep
    // the next surviving visible deal at its original viewport offset.
    preserveReadingPosition(update) {
      const scheduled = this.readingAnchors !== null;
      if (!scheduled) {
        this.readingAnchors = [...this.$el.querySelectorAll(".deal-row")].flatMap(row => {
          const rect = row.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight
            ? [{ id: row.dataset.topicId, top: rect.top }]
            : [];
        });
      }
      update();
      const positions = new Map(this.filteredTopics.map((topic, index) => [String(topic.topic_id), index]));
      const anchor = this.readingAnchors.find(({ id }) => positions.has(id));
      if (anchor) this.visibleTopicCount = Math.max(this.visibleTopicCount, positions.get(anchor.id) + 1);
      if (!scheduled) this.$nextTick(() => {
        const anchors = this.readingAnchors;
        this.readingAnchors = null;
        if (!this.$el?.isConnected) return;
        for (const { id, top } of anchors) {
          const row = this.$el.querySelector(`[data-topic-id="${id}"]`);
          if (!row) continue;
          const delta = row.getBoundingClientRect().top - top;
          if (delta) window.scrollBy(0, delta);
          break;
        }
      });
    },

    applyPendingDeals() {
      this.preserveReadingPosition(() => {
        if (this.pendingTopics !== null) this.rawTopics = this.pendingTopics;
        if (this.pendingEnrichment !== null) this.enrichment = this.pendingEnrichment;
        this.topics = attachTags(this.rawTopics, this.enrichment);
        this.tagVocabulary = Array.isArray(this.enrichment?.vocabulary) ? this.enrichment.vocabulary : [];
        this.pendingTopics = null;
        this.pendingEnrichment = null;
      });
    },

    fetchDeals({ background = false } = {}) {
      // A manual refresh supersedes all outstanding requests, including optional ones.
      this.refreshController?.abort();
      const controller = markRaw(new AbortController());
      this.refreshController = controller;
      const current = () => !controller.signal.aborted && this.refreshController === controller;
      const stageChanges = background && this.topics.length > 0;
      this.isLoading = true;
      this.isBackgroundLoading = stageChanges;
      this.loadError = "";

      const finishLoading = () => {
        if (current()) {
          this.isLoading = false;
          this.isBackgroundLoading = false;
        }
      };

      const topicsRequest = fetchJson("/topics.json", controller.signal)
        .then(result => {
          if (!current()) return;
          if (isUnchangedPayload(result, this.lastTopicsEtag, this.rawTopics)) {
            this.lastCheckedAt = Date.now();
            // An unchanged poll carries nothing new, so it clears any staged update.
            this.pendingTopics = null;
            return;
          }
          const response = result.data;
          if (!Array.isArray(response)) throw new Error("Invalid topics response");
          this.lastCheckedAt = Date.now();
          this.lastTopicsEtag = result.etag ?? null;
          if (stageChanges) {
            this.pendingTopics = response;
          } else {
            this.preserveReadingPosition(() => {
              this.rawTopics = response;
              this.topics = attachTags(response, this.enrichment);
              this.pendingTopics = null;
              this.pendingEnrichment = null;
            });
          }
        })
        .catch(error => {
          if (!current()) return;
          this.loadError = "Could not load deals. Check your connection and try again.";
          console.error("Failed to fetch deals:", error);
        })
        .finally(finishLoading);

      const enrichmentRequest = fetchJson("/enrichment.json", controller.signal)
        .then(result => {
          if (!current()) return;
          if (isUnchangedPayload(result, this.lastEnrichmentEtag, this.enrichment)) {
            this.pendingEnrichment = null;
            return;
          }
          const enrichment = result.data;
          if (!enrichment || typeof enrichment !== "object" || Array.isArray(enrichment)) return;
          this.lastEnrichmentEtag = result.etag ?? null;
          if (stageChanges) {
            this.pendingEnrichment = enrichment;
          } else {
            this.preserveReadingPosition(() => {
              this.enrichment = enrichment;
              this.tagVocabulary = Array.isArray(enrichment.vocabulary) ? enrichment.vocabulary : [];
              this.topics = attachTags(this.rawTopics, enrichment);
            });
          }
        }).catch(() => {}); // Keep the last known tags on a transient failure.

      const healthRequest = fetchJson("/health.json", controller.signal)
        .then(result => {
          if (!current() || result === NOT_MODIFIED) return;
          const health = result.data;
          if (!health) return;
          this.lastSuccessfulRefresh = health.completed_at ?? null;
          this.refreshDegraded = health.ok === false;
        }).catch(() => {});

      return Promise.all([topicsRequest, enrichmentRequest, healthRequest]);
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
              this.$refs.merchantSheet?.$refs.sheetPanel
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
      this.$nextTick(() => this.$refs.merchantSheet?.focusSearch());
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
      const panel = this.$refs.merchantSheet?.$refs.sheetPanel;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
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

    toggleInfoOverlay() {
      this.infoOverlayVisible = !this.infoOverlayVisible;
    },

    toggleSettingsPanel() {
      this.settingsPanelVisible = !this.settingsPanelVisible;
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
          <FilterBar
            ref="filterBar"
            v-model="filterInput"
            :active-filters="activeFilters"
            :suggestions="tagSuggestions"
            :suggestion-index="tagSuggestionIndex"
            :regex-error="isRegexError"
            @apply="onFilterEnter"
            @tab-complete="onFilterTab"
            @escape="onFilterEscape"
            @move-suggestion="moveTagSuggestion"
            @highlight-suggestion="tagSuggestionIndex = $event"
            @accept-suggestion="acceptTagSuggestion"
            @clear-filter="clearFilter"
            @focus="onFilterFocus"
            @blur="onFilterBlur"
          />
          <!-- Desktop buttons -->
          <button
            class="icon-button desktop-only"
            title="Refresh deals"
            @click="fetchDeals"
            :disabled="isLoading"
          >
            <span
              class="material-symbols-outlined"
              :class="{ spinning: isLoading && !isBackgroundLoading }"
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
          <button
            class="icon-button desktop-only"
            title="Settings"
            @click="toggleSettingsPanel"
          >
            <span class="material-symbols-outlined">settings</span>
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
                  :class="{ spinning: isLoading && !isBackgroundLoading }"
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
                @click="handleMenuAction(toggleSettingsPanel)"
              >
                <span class="material-symbols-outlined">settings</span>
                <span>Settings</span>
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
      <div v-else-if="loadError && topics.length === 0" class="feed-error" role="alert">
        <span class="material-symbols-outlined">error</span>
        <span>{{ loadError }}</span>
        <button type="button" @click="fetchDeals">Try again</button>
      </div>
      <div class="cards-wrapper" v-else>
        <div v-if="loadError" class="feed-error" role="alert">{{ loadError }}</div>
        <p v-if="feedStatusText" class="feed-status">
          {{ feedStatusText }}<span v-if="refreshDegraded" class="feed-status-warning"> · refresh degraded</span>
        </p>
        <button
          v-if="pendingTopics !== null || pendingEnrichment !== null"
          type="button"
          class="feed-update"
          @click="applyPendingDeals"
        >
          Update deals<span v-if="pendingNewCount"> · {{ pendingNewCount }} new</span>
        </button>
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
            <DealRow
              v-for="topic in displayedTopics"
              :key="topic.topic_id"
              :topic="topic"
              :seen="seen.has(String(topic.topic_id))"
              :highlight="highlightText"
              :theme="resolvedTheme"
              @deal-click="onDealClick"
              @filter-dealer="filterByDealer"
              @filter-tag="filterByTag"
            />
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
    />
    <SettingsPanel
      :visible="settingsPanelVisible"
      @close="toggleSettingsPanel"
      @export-settings="exportSettings"
      @import-settings="importSettings"
    />
    <MerchantSheet
      v-if="mobileMerchantSheetOpen"
      ref="merchantSheet"
      v-model:search="mobileMerchantSearch"
      :hidden-options="mobileHiddenMerchantOptions"
      :visible-options="mobileVisibleMerchantOptions"
      :hidden-count="hiddenMerchants.length"
      @close="closeMobileMerchantSheet"
      @hide-merchant="(name) => setMerchantHidden(name, true)"
      @unhide-merchant="(name) => setMerchantHidden(name, false)"
      @clear-hidden="clearHiddenMerchants"
    />
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

.merchant-option input[type="checkbox"] {
  accent-color: var(--accent);
}

.merchant-option span {
  flex: 1;
}

.merchant-option small {
  color: var(--text-secondary);
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

.feed-update {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  white-space: nowrap;
  padding: 0.45rem 0.8rem;
  border: 1px solid currentColor;
  border-radius: 0.4rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: 0 2px 8px #0003;
  font: inherit;
  cursor: pointer;
}
</style>
