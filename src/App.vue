<script>
import axios from "axios";
import moment from "moment";
import Loading from "vue-loading-overlay";
import { install } from "@github/hotkey";

import "vue-loading-overlay/dist/css/index.css";

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
          this.sortTable(this.sortColumn, false);
        })
        .catch((err) => {
          console.log(err.response);
        });
    },
    sortTable: function sortTable(col, flipAscending) {
      if (this.sortColumn === col && flipAscending) {
        this.ascending = !this.ascending;
      }

      var ascending = this.ascending;

      localStorage.setItem("ascending", this.ascending);
      localStorage.setItem("sortColumn", col);
      this.sortColumn = col;

      this.topics.sort(function (a, b) {
        if (a[col] > b[col]) {
          return ascending ? -1 : 1;
        } else if (a[col] < b[col]) {
          return ascending ? 1 : -1;
        }
        return 0;
      });
    },
    isMobile() {
      if (
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        )
      ) {
        return true;
      } else {
        return false;
      }
    },
  },
  computed: {
    formatDate() {
      return (v) => {
        return moment(String(v)).format("hh:mm A z (MM/DD)");
      };
    },
    columns() {
      return {
        Deal: "deal",
        Score: "score",
        Views: "total_views",
        "Last Reply": "last_post_time",
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
    showBeforeTargetDate() {
      const now = new Date();
      const target = new Date('2025-08-20T00:00:00');
      return now < target;
    }
  },
  components: {
    Loading,
  },
};
</script>

<template>
  <link rel="shortcut icon" type="image/png" href="/favicon.png" />
  <body>
    <input
      class="form-control"
      type="text"
      id="filter"
      placeholder="Filter"

      data-hotkey="/"
      v-model="filter"
      v-on:keyup.enter="createFilterRoute(this.filter.toString())"
      v-on:keyup.escape="this.$refs.filter.blur()"
      ref="filter"
    />
    <table class="table table-hover">
      <thead class="thead text-muted">
        <tr>
          <th
            v-for="(col, key) in columns"
            v-on:click="sortTable(col, true)"
            :key="col"
          >
            {{ key }}
            <div
              class="arrow"
              v-if="col == sortColumn"
              v-bind:class="ascending ? 'arrow_up' : 'arrow_down'"
            ></div>
          </th>
        </tr>
      </thead>
      <tbody>
        <loading
          v-model:active="isLoading"
          color="#ccc"
          opacity="0"
          loader="bars"
          :is-full-page="false"
        >
        </loading>
        <tr
          scope="row"
          v-for="(topic, index) in filteredTopics"
          :key="`topic.topic_id-${index}`"
        >
          <td scope="col">
            <a
              :href="`https://forums.redflagdeals.com${topic.web_path}`"
              target="_blank"
              v-html="
                highlightMatches(
                  topic.title + ' [' + topic.Offer.dealer_name + '] '
                )
              "
            ></a>
            <a
              :href="`${topic.Offer.url}`"
              target="_blank"
              v-if="topic.Offer.url"
              ><span class="material-symbols-outlined"> link </span></a
            >
            <span v-if="!topic.Offer.url" class="material-symbols-outlined">
              link_off
            </span>
          </td>
          <td v-if="topic.score > 0" scope="col" class="green-score">
            +{{ topic.score }}
          </td>
          <td v-if="topic.score < 0" scope="col" class="red-score">
            {{ topic.score }}
          </td>
          <td v-if="topic.score == 0" scope="col">
            {{ topic.score }}
          </td>
          <td scope="col">{{ topic.total_views }}</td>
          <td scope="col">{{ formatDate(topic.last_post_time) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="showBeforeTargetDate">
      <footer class="fixed-bottom">
        PSA: <a href="https://rfd.fyi">rfd.fyi</a> will not be renewed after 2025-08-20. Please use <a href="https://rfd.davegallant.ca">rfd.davegallant.ca</a>.
      </footer>
    </div>
  </body>
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
