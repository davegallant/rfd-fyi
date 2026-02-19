<template>
  <div class="info-overlay" v-if="visible" @click.self="closeOverlay">
    <div class="info-panel">
        <strong>Source: </strong>
        <a href="https://github.com/davegallant/rfd-fyi" target="_blank" rel="noopener noreferrer">
          https://github.com/davegallant/rfd-fyi
        </a>
      <h3>Keyboard Shortcuts</h3>
      <table class="shortcuts-table">
        <tr>
          <td><strong>r</strong></td>
          <td>Refresh deals</td>
        </tr>
        <tr>
          <td><strong>s</strong></td>
          <td>Toggle sort</td>
        </tr>
        <tr>
          <td><strong>v</strong></td>
          <td>Toggle view mode</td>
        </tr>
        <tr>
          <td><strong>t</strong></td>
          <td>Toggle theme</td>
        </tr>
        <tr>
          <td><strong>/</strong></td>
          <td>Filter deals</td>
        </tr>
      </table>
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
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 20px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  text-align: center;
}

.info-panel h2 {
  margin-top: 0;
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
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.close-button:hover {
  background-color: #0056b3;
}
</style>
