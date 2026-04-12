<template>
  <div class="info-overlay" v-if="visible" @click.self="closeOverlay">
    <div class="info-panel">
        <strong>Source: </strong>
        <a href="https://github.com/davegallant/rfd-fyi" target="_blank" rel="noopener noreferrer">
          https://github.com/davegallant/rfd-fyi
        </a>
      <p class="version">{{ version }}</p>
      <h3>Keyboard Shortcuts</h3>
      <table class="shortcuts-table">
        <tbody>
          <tr>
            <td><strong>r</strong></td>
            <td>Refresh deals</td>
          </tr>
          <tr>
            <td><strong>s</strong></td>
            <td>Cycle sort method</td>
          </tr>
          <tr>
            <td><strong>t</strong></td>
            <td>Toggle theme</td>
          </tr>
          <tr>
            <td><strong>/</strong></td>
            <td>Filter deals</td>
          </tr>
        </tbody>
      </table>
      <p class="html-alt">
        Click <a href="/html">here</a> for an HTML-only site
      </p>
      <button class="close-button" @click="closeOverlay">Close</button>
    </div>
  </div>
</template>

<script>
export default {
  name: "InfoOverlay",
  props: {
    visible: {
      type: Boolean,
      required: true,
    },
  },
  data() {
    return {
      version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
    };
  },
  methods: {
    closeOverlay() {
      this.$emit("close");
    },
  },
};
</script>

<style scoped>
.info-overlay {
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

.info-panel {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 20px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 4px 24px var(--shadow-medium);
  border: 1px solid var(--border-color-light);
  text-align: center;
}

.info-panel h2 {
  margin-top: 0;
}

.version {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.html-alt {
  margin: 12px 0 0;
  font-size: 14px;
}

.info-panel .shortcuts-table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px auto;
  text-align: left;
  padding-left: 40px;
  display: table;
  margin-left: auto;
  margin-right: auto;
}

.info-panel .shortcuts-table td {
  padding: 8px;
  text-align: left;
  vertical-align: middle;
  padding-left: 40px;
  padding-right: 20px;
}

.close-button {
  margin-top: 20px;
  padding: 10px 20px;
  background-color: var(--accent);
  color: var(--score-positive-text);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
  font-size: 14px;
  transition: background-color 0.2s ease;
}

.close-button:hover {
  background-color: var(--accent-hover);
}
</style>