<script>
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import Loading from "vue-loading-overlay";
import { install } from "@github/hotkey";
import { ref, reactive } from "vue";

import "vue-loading-overlay/dist/css/index.css";

// Configure day.js with UTC support
dayjs.extend(utc);

export default {
  data() {
    return {
      ascending: this.ascending,
      filter: window.location.href.split("filter=")[1] || "",
      sortColumn: this.sortColumn,
      topics: [],
      hoveredTopicId: null,
      tooltipData: {},
      loadingTooltip: {},
      tooltipPosition: { x: 0, y: 0 },
    };
  },
  mounted() {
    window.addEventListener("keydown", this.handleKeyDown);
    this.fetchDeals();
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
  },
  methods: {
    handleKeyDown(event) {
      const isInput = ["INPUT", "TEXTAREA"].includes(
        document.activeElement.tagName
      );
      if (event.key === "/" && !isInput) {
        event.preventDefault(); // prevent typing `/` into whatever is focused
        this.$refs.filter.focus();
      }
    },
    handleTitleHover(topic, event) {
      this.hoveredTopicId = topic.topic_id;
      this.tooltipPosition = {
        x: event.clientX,
        y: event.clientY,
      };
      this.loadTopicDetails(topic.topic_id);
    },
    handleTitleLeave() {
      this.hoveredTopicId = null;
    },
    handleMouseMove(event) {
      if (this.hoveredTopicId !== null) {
        this.tooltipPosition = {
          x: event.clientX,
          y: event.clientY,
        };
      }
    },
    loadTopicDetails(topicId) {
      if (!topicId) {
        console.warn("Topic ID is undefined");
        return;
      }

      if (this.tooltipData[topicId]) {
        return; // Already loaded
      }

      if (this.loadingTooltip[topicId]) {
        return; // Already loading
      }

      this.loadingTooltip[topicId] = true;

      axios
        .get(`api/v1/topics/${topicId}`)
        .then((response) => {
          this.tooltipData[topicId] = response.data;
        })
        .catch((err) => {
          console.log("Error loading topic details:", err);
        })
        .finally(() => {
          this.loadingTooltip[topicId] = false;
        });
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
        return date.format("hh:mm A (MM/DD)");
      };
    },
    filteredTopics() {
      return this.topics.filter((row) => {
        const titles = (
          row.title.toString() +
          " [" +
          row.Offer.dealer_name +
          "]"
        ).toLowerCase();
        const filterTerm = this.filter.toLowerCase();
        return titles.includes(filterTerm);
      });
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
  },
};
</script>

<script setup>
const headers = [
  { title: "Deal", value: "title", align: "center" },
  { title: "Score", value: "score", align: "center", sortable: true },
  {
    title: "Last Post",
    value: "last_post_time",
    align: "center",
    sortable: true,
  },
];
const sortBy = ref([{ key: "score", order: "desc" }]); // Vuetify 3 format
</script>

<template>
  <v-app>
    <v-main>
      <link rel="shortcut icon" type="image/png" href="/favicon.png" />
      <body>
        <v-text-field
          v-model="filter"
          label="Filter"
          ref="filter"
          @keyup.enter="createFilterRoute(filter.toString())"
          @keyup.esc="$refs.filter.blur()"
          hide-details="true"
        />
        <v-data-table
          :headers="headers"
          :items="filteredTopics"
          :sort-by="sortColumn"
          v-model:sortBy="sortBy"
          :items-per-page="25"
        >
          <template #item.title="{ item }">
            <a
              :href="`https://forums.redflagdeals.com${item.web_path}`"
              target="_blank"
              @mouseenter="handleTitleHover(item, $event)"
              @mouseleave="handleTitleLeave"
              @mousemove="handleMouseMove"
              v-html="
                highlightMatches(
                  item.title + ' [' + item.Offer.dealer_name + '] '
                )
              "
            ></a>
            <a :href="item.Offer.url" target="_blank" v-if="item.Offer.url">
              <span class="material-symbols-outlined"> link </span>
            </a>
            <span v-else class="material-symbols-outlined"> link_off </span>
          </template>

          <template #item.score="{ item }">
            <span v-if="item.score > 0" class="green-score"
              >+{{ item.score }}</span
            >
            <span v-else-if="item.score < 0" class="red-score">{{
              item.score
            }}</span>
            <span v-else>{{ item.score }}</span>
          </template>

          <template #item.last_post_time="{ item }">
            {{ formatDate(item.last_post_time) }}
          </template>

          <template #loading>
            <v-progress-linear indeterminate color="grey" />
          </template>
        </v-data-table>

        <!-- Tooltip for deal details -->
        <div
          v-if="hoveredTopicId !== null && tooltipData[hoveredTopicId]"
          class="deal-tooltip"
          :style="{
            position: 'fixed',
            left: tooltipPosition.x + 10 + 'px',
            top: tooltipPosition.y + 10 + 'px',
            zIndex: 9999,
          }"
        >
          <div class="tooltip-content">
            <div class="tooltip-header">{{ tooltipData[hoveredTopicId].topic.title }}</div>
              <div class="tooltip-dealer">
                {{ tooltipData[hoveredTopicId].topic.Offer.dealer_name }}
              </div>
              <div class="tooltip-stats">
                <span class="stat-item">
                  <span class="material-symbols-outlined">visibility</span>
                  {{ tooltipData[hoveredTopicId].topic.total_views }} views
                </span>
                <span class="stat-item">
                  <span class="material-symbols-outlined">chat</span>
                  {{ tooltipData[hoveredTopicId].topic.total_replies }} replies
                </span>
              </div>
            <div v-if="tooltipData[hoveredTopicId].description" class="tooltip-description">
              <strong>Description:</strong>
              {{ tooltipData[hoveredTopicId].description }}
            </div>
            <div v-if="tooltipData[hoveredTopicId].first_post" class="tooltip-first-post">
              <strong>First Post:</strong>
              {{ tooltipData[hoveredTopicId].first_post }}
            </div>
            <div class="tooltip-times">
              <div>Posted: {{ formatDate(tooltipData[hoveredTopicId].topic.post_time) }}</div>
              <div>Last Post: {{ formatDate(tooltipData[hoveredTopicId].topic.last_post_time) }}</div>
            </div>
          </div>
        </div>
      </body>
    </v-main>
  </v-app>
</template>

<style scoped>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}

.fixed-bottom {
  background: #ffc;
  color: black;
}

.deal-tooltip {
  pointer-events: none;
  max-width: 400px;
}

.tooltip-content {
  background: #24283b;
  border: 2px solid #a9b1d6;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  font-size: 13px;
  color: #e0e0e0;
  text-align: left;
}

.tooltip-header {
  font-weight: bold;
  font-size: 14px;
  color: #d0d0d0;
  margin-bottom: 8px;
  white-space: normal;
  word-wrap: break-word;
}

.tooltip-dealer {
  font-size: 12px;
  color: #c0c0c0;
  margin-bottom: 8px;
}

.tooltip-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stat-item .material-symbols-outlined {
  font-size: 16px;
}

.tooltip-description {
  margin-bottom: 8px;
  padding: 8px;
  background: rgba(160, 160, 160, 0.1);
  border-left: 2px solid #a9b1d6;
  border-radius: 2px;
  font-size: 12px;
  white-space: normal;
  word-wrap: break-word;
  max-height: 60px;
  overflow-y: auto;
}

.tooltip-first-post {
  margin-bottom: 8px;
  padding: 8px;
  background: rgba(160, 160, 160, 0.1);
  border-left: 2px solid #a9b1d6;
  border-radius: 2px;
  font-size: 12px;
  white-space: normal;
  word-wrap: break-word;
  max-height: 60px;
  overflow-y: auto;
}

.tooltip-times {
  font-size: 11px;
  color: #b0b0b0;
  border-top: 1px solid #555555;
  padding-top: 8px;
  margin-top: 8px;
}
</style>
