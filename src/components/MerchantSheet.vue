<script>
export default {
  name: "MerchantSheet",

  props: {
    hiddenOptions: { type: Array, default: () => [] },
    visibleOptions: { type: Array, default: () => [] },
    search: { type: String, default: "" },
    hiddenCount: { type: Number, default: 0 },
  },

  emits: ["update:search", "close", "hide-merchant", "unhide-merchant", "clear-hidden"],

  mounted() {
    this.focusSearch();
  },

  methods: {
    focusSearch() {
      this.$refs.sheetSearch?.focus();
    },
  },
};
</script>

<template>
  <div
    class="mobile-merchant-sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mobile-merchant-sheet-title"
    @click.self="$emit('close')"
  >
    <section ref="sheetPanel" class="mobile-merchant-sheet-panel">
      <header class="mobile-merchant-sheet-header">
        <h2 id="mobile-merchant-sheet-title">Merchants</h2>
        <button class="mobile-merchant-sheet-close" aria-label="Close merchants" @click="$emit('close')">
          <span class="material-symbols-outlined">close</span>
        </button>
      </header>
      <div class="mobile-merchant-sheet-controls">
        <input
          ref="sheetSearch"
          :value="search"
          @input="$emit('update:search', $event.target.value)"
          class="merchant-search"
          type="search"
          placeholder="Search merchants"
          aria-label="Search merchants"
        />
        <button class="merchant-reset" :disabled="hiddenCount === 0" @click="$emit('clear-hidden')">Show all</button>
      </div>
      <div class="mobile-merchant-sheet-results">
        <section v-if="hiddenOptions.length" aria-labelledby="hidden-merchants-title">
          <h3 id="hidden-merchants-title">Hidden</h3>
          <button
            v-for="merchant in hiddenOptions"
            :key="merchant.key"
            class="mobile-merchant-option mobile-merchant-option--hidden"
            @click="$emit('unhide-merchant', merchant.name)"
          >
            <span>{{ merchant.name }}</span>
            <small>{{ merchant.count ?? "Not in feed" }}</small>
            <strong>Restore</strong>
          </button>
        </section>
        <section v-if="visibleOptions.length" aria-labelledby="visible-merchants-title">
          <h3 id="visible-merchants-title">Visible</h3>
          <button
            v-for="merchant in visibleOptions"
            :key="merchant.key"
            class="mobile-merchant-option"
            @click="$emit('hide-merchant', merchant.name)"
          >
            <span>{{ merchant.name }}</span>
            <small>{{ merchant.count }}</small>
            <strong>Hide</strong>
          </button>
        </section>
        <p v-if="!hiddenOptions.length && !visibleOptions.length" class="merchant-empty">No merchants match.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
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
</style>
