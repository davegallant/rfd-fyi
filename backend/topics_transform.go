package main

import "strings"

// ComputeScores sets each topic's Score from Votes (Up - Down). It mutates the slice elements.
func ComputeScores(topics []Topic) []Topic {
	for i := range topics {
		topics[i].Score = topics[i].Votes.Up - topics[i].Votes.Down
	}
	return topics
}

// DeduplicateTopics keeps the first topic per TopicID order-preserving.
func DeduplicateTopics(topics []Topic) []Topic {
	seen := make(map[uint]bool)
	var out []Topic
	for _, topic := range topics {
		if !seen[topic.TopicID] {
			seen[topic.TopicID] = true
			out = append(out, topic)
		}
	}
	return out
}

// FilterNonSponsorTopics drops topics whose title is sponsored.
func FilterNonSponsorTopics(topics []Topic) []Topic {
	var out []Topic
	for _, topic := range topics {
		if strings.HasPrefix(topic.Title, "[Sponsored]") {
			continue
		}
		out = append(out, topic)
	}
	return out
}
