<script>
export default {
  name: "FilterBar",

  props: {
    activeFilters: { type: Array, required: true },
    modelValue: { type: String, default: "" },
    suggestions: { type: Array, default: () => [] },
    suggestionIndex: { type: Number, default: -1 },
    regexError: { type: Boolean, default: false },
  },

  emits: [
    "update:modelValue",
    "apply",
    "tab-complete",
    "escape",
    "move-suggestion",
    "highlight-suggestion",
    "accept-suggestion",
    "clear-filter",
    "focus",
    "blur",
  ],

  methods: {
    focusInput() {
      this.$refs.filterInput?.focus();
    },

    blurInput() {
      this.$refs.filterInput?.blur();
    },

    focusAndScrollIntoView() {
      const input = this.$refs.filterInput;
      if (!input) return;
      input.scrollIntoView({ behavior: "smooth", block: "nearest" });
      input.focus();
    },

    moveCursorToEnd() {
      const input = this.$refs.filterInput;
      if (!input) return;
      input.setSelectionRange(input.value.length, input.value.length);
    },
  },
};
</script>

<template>
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
          @click="$emit('clear-filter', index)"
          title="Clear filter"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </span>
      <input
        ref="filterInput"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
        type="text"
        placeholder="filter"
        class="search-input"
        :class="{ 'search-input--regex-error': regexError }"
        :title="regexError ? 'Invalid regex' : ''"
        @keydown.enter="$emit('apply', $event)"
        @keydown.tab="$emit('tab-complete', $event)"
        @keydown.esc="$emit('escape', $event)"
        @keydown.down="$emit('move-suggestion', 1, $event)"
        @keydown.up="$emit('move-suggestion', -1, $event)"
        @blur="$emit('blur', $event)"
        @focus="$emit('focus', $event)"
      />
    </div>
    <!-- mousedown.prevent keeps the input focused so the click lands -->
    <ul
      v-if="suggestions.length"
      class="tag-suggestions"
      role="listbox"
      @mousedown.prevent
    >
      <li
        v-for="(suggestion, i) in suggestions"
        :key="suggestion"
        role="option"
        :aria-selected="i === suggestionIndex"
      >
        <button
          type="button"
          tabindex="-1"
          class="tag-suggestion"
          :class="{
            'tag-suggestion--highlighted': i === suggestionIndex,
          }"
          @mouseenter="$emit('highlight-suggestion', i)"
          @click="$emit('accept-suggestion', suggestion)"
        >
          {{ suggestion }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
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
</style>
