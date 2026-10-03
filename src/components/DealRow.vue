<script>
import dayjs from "dayjs";
import { getDealerStyle } from "../dealerColors.js";
import { visibleTags } from "../enrichment.js";
import { isHotDeal } from "../hotDeals.js";

export default {
  name: "DealRow",

  props: {
    topic: { type: Object, required: true },
    seen: { type: Boolean, default: false },
    highlight: { type: Function, required: true },
    theme: { type: String, default: "light" },
  },

  emits: ["deal-click", "filter-dealer", "filter-tag"],

  computed: {
    hot() {
      return isHotDeal(this.topic);
    },

    dealerStyle() {
      return getDealerStyle(this.topic.Offer?.dealer_name, this.theme);
    },

    tags() {
      return visibleTags(this.topic.tags);
    },
  },

  methods: {
    formatDate(dateString) {
      return dayjs(String(dateString)).format("YYYY-MM-DD hh:mm A");
    },
  },
};
</script>

<template>
  <div
    class="deal-row"
    :data-topic-id="topic.topic_id"
    :class="{
      'deal-row--seen': seen,
      'deal-row--hot': hot,
    }"
    @click.capture="$emit('deal-click', topic)"
  >
    <div class="card-header">
      <div class="title-with-link">
        <span class="deal-text">
          <span
            v-if="hot"
            class="hot-deal-icon"
            title="Hot deal"
            aria-label="Hot deal"
            >🔥</span
          >
          <button
            v-if="topic.Offer?.dealer_name"
            class="dealer-name dealer-label dealer-label--clickable"
            :style="dealerStyle"
            :title="`Filter by ${topic.Offer.dealer_name}`"
            @click="$emit('filter-dealer', topic.Offer.dealer_name)"
            v-html="highlight(topic.Offer.dealer_name)"
          ></button
          ><span
            v-if="topic.Offer?.dealer_name"
            class="dealer-title-gap"
            aria-hidden="true"
          ></span>
          <a
            :href="`https://forums.redflagdeals.com${topic.web_path}`"
            target="_blank"
            class="deal-title"
            v-html="highlight(topic.title)"
          ></a
          ><span
            v-if="tags.length"
            class="tag-chips"
          >
            <button
              v-for="tag in tags"
              :key="tag"
              class="tag-chip"
              :title="`Filter by ${tag}`"
              @click.stop="$emit('filter-tag', tag)"
            >
              {{ tag }}
            </button>
          </span>
        </span>
        <a
          v-if="topic.Offer?.url"
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
</template>

<style scoped>
.deal-row--seen {
  opacity: 0.4;
  transition: opacity 0.2s ease;
}

.deal-row--seen:hover,
.deal-row--seen:focus-within {
  opacity: 1;
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
</style>
