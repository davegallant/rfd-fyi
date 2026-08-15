<template>
  <div class="settings-overlay" v-if="visible" @click.self="$emit('close')">
    <div class="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
      <h2 class="settings-title">
        <span class="material-symbols-outlined">settings</span>
        Settings
      </h2>

      <section class="settings-section">
        <h3>Settings backup</h3>
        <p class="section-description">
          Export your display preferences, hidden merchants, and seen deals to a
          JSON file, or restore a backup.
        </p>
        <div class="actions-row">
          <button type="button" @click="$emit('export-settings')">Export settings</button>
          <label>
            Import settings
            <input type="file" accept="application/json,.json" @change="importSettings" />
          </label>
        </div>
      </section>

      <button class="close-button" @click="$emit('close')">Close</button>
    </div>
  </div>
</template>

<script>
export default {
  name: "SettingsPanel",
  props: {
    visible: {
      type: Boolean,
      required: true,
    },
  },
  methods: {
    importSettings(event) {
      const file = event.target.files?.[0];
      if (file) this.$emit("import-settings", file);
      event.target.value = "";
    },
  },
};
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-panel {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 16px;
  padding: 20px;
  max-width: 27rem;
  width: 90%;
  max-height: 90%;
  overflow-y: auto;
  box-shadow: 0 8px 28px var(--shadow-medium);
  border: 1px solid var(--border-color-light);
}

.settings-title {
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.25rem;
}

.settings-title .material-symbols-outlined {
  font-size: 1.4rem;
  color: var(--text-secondary);
}

.settings-section {
  padding: 12px 0 16px;
  border-bottom: 1px solid var(--border-color-light);
}

.settings-section h3 {
  margin: 0 0 4px;
  font-size: 0.9375rem;
}

.section-description {
  margin: 0 0 12px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.actions-row button,
.actions-row label {
  padding: 8px 12px;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 0.8125rem;
}

.actions-row input[type="file"] {
  display: none;
}

.close-button {
  margin-top: 20px;
  width: 100%;
  padding: 10px 20px;
  background-color: var(--accent);
  color: var(--score-positive-text);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
  font-size: 0.875rem;
  transition: background-color 0.2s ease;
}

.close-button:hover {
  background-color: var(--accent-hover);
}
</style>
