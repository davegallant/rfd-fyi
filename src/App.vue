<script>
import axios from "axios";
import moment from "moment";
import Loading from "vue-loading-overlay";
import { install } from "@github/hotkey";

import "vue-loading-overlay/dist/css/index.css";
import { ref } from "vue";

export default {
  data() {
    return {
      ascending: this.ascending,
      filter: window.location.href.split("filter=")[1] || "",
      isLoading: false,
      sortColumn: this.sortColumn,
      topics: [],
    };
  },
  mounted() {
    // Install all the hotkeys on the page
    for (const el of document.querySelectorAll("[data-hotkey]")) {
      install(el);
    }
    this.sortColumn = localStorage.getItem("sortColumn") || "score";
    this.ascending =
      localStorage.getItem("ascending") === "false" ? false : true;
    this.isLoading = true;
    this.fetchDeals();
  },
  methods: {
    createFilterRoute(params) {
      this.$refs.filter.blur();
      history.pushState(
        {},
        null,
        `${window.location.origin}#/filter=${encodeURIComponent(params)}`
      );
    },
    fetchDeals() {
      this.isLoading = true;
      axios
        .get("api/v1/topics")
        .then((response) => {
          this.topics = response.data;
          this.isLoading = false;
        })
        .catch((err) => {
          console.log(err.response);
        });
    },
  },
  computed: {
    formatDate() {
      return (v) => {
        return moment(String(v)).format("hh:mm A z (MM/DD)");
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
  components: {
    Loading,
  },
};
</script>

<script setup>
const headers = [
  { title: "Deal", value: "title", align: "center" },
  { title: "Score", value: "score", align: "center", sortable: true },
  { title: "Views", value: "total_views", align: "center", sortable: true },
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
          density="comfortable"
          ref="filter"
          @keyup.enter="createFilterRoute(filter.toString())"
          @keyup.esc="$refs.filter.blur()"
          data-hotkey="/"
          hide-details
        />
        <v-data-table
          :headers="headers"
          :items="filteredTopics"
          :sort-by="sortColumn"
          :sort-desc="!ascending"
          v-model:sortBy="sortBy"
          :items-per-page="25"
        >
          <template #item.title="{ item }">
            <a
              :href="`https://forums.redflagdeals.com${item.web_path}`"
              target="_blank"
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
      </body>
    </v-main>
  </v-app>
</template>

<style>
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
</style>
