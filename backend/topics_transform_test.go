package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestComputeScores(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		input []Topic
		want  []int
	}{
		{
			name: "votes produce score",
			input: []Topic{
				{Votes: Votes{Up: 5, Down: 2}},
				{Votes: Votes{Up: 0, Down: 0}},
			},
			want: []int{3, 0},
		},
		{
			name:  "empty slice",
			input: []Topic{},
			want:  []int{},
		},
		{
			name: "missing vote fields unmarshal as zero",
			input: []Topic{
				{TopicID: 1, Title: "t"},
			},
			want: []int{0},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := ComputeScores(append([]Topic(nil), tt.input...))
			scores := make([]int, len(got))
			for i := range got {
				scores[i] = got[i].Score
			}
			if !reflect.DeepEqual(scores, tt.want) {
				t.Fatalf("scores = %#v, want %#v", scores, tt.want)
			}
		})
	}
}

func TestDeduplicateTopics(t *testing.T) {
	t.Parallel()
	in := []Topic{
		{TopicID: 1, Title: "a"},
		{TopicID: 2, Title: "b"},
		{TopicID: 1, Title: "dup"},
	}
	got := DeduplicateTopics(append([]Topic(nil), in...))
	if len(got) != 2 || got[0].TopicID != 1 || got[1].TopicID != 2 {
		t.Fatalf("got %#v", got)
	}
	t.Run("empty", func(t *testing.T) {
		t.Parallel()
		if len(DeduplicateTopics(nil)) != 0 {
			t.Fatal("expected empty")
		}
	})
}

func TestFilterNonSponsorTopics(t *testing.T) {
	t.Parallel()
	in := []Topic{
		{TopicID: 1, Title: "Deal"},
		{TopicID: 2, Title: "[Sponsored] Ad"},
		{TopicID: 3, Title: "Other"},
	}
	got := FilterNonSponsorTopics(append([]Topic(nil), in...))
	if len(got) != 2 || got[0].TopicID != 1 || got[1].TopicID != 3 {
		t.Fatalf("got %#v", got)
	}
	t.Run("empty", func(t *testing.T) {
		t.Parallel()
		if len(FilterNonSponsorTopics(nil)) != 0 {
			t.Fatal("expected empty")
		}
	})
	t.Run("all sponsored", func(t *testing.T) {
		t.Parallel()
		got := FilterNonSponsorTopics([]Topic{{Title: "[Sponsored] x"}})
		if len(got) != 0 {
			t.Fatalf("got %#v", got)
		}
	})
}

func TestTransformFromPartialJSON(t *testing.T) {
	t.Parallel()
	// Empty object unmarshals to zero TopicsResponse; must not panic when filtering.
	var empty TopicsResponse
	if err := json.Unmarshal([]byte(`{}`), &empty); err != nil {
		t.Fatal(err)
	}
	out := FilterNonSponsorTopics(ComputeScores(empty.Topics))
	if len(out) != 0 {
		t.Fatalf("expected no topics, got %d", len(out))
	}

	// Null topics field
	raw := `{"topics":null}`
	var tr TopicsResponse
	if err := json.Unmarshal([]byte(raw), &tr); err != nil {
		t.Fatal(err)
	}
	if tr.Topics != nil {
		t.Fatalf("topics = %#v, want nil slice from null", tr.Topics)
	}
	_ = FilterNonSponsorTopics(tr.Topics) // nil slice

	// Topic missing nested votes / offer — zero values
	raw2 := `{"topics":[{"topic_id":7,"title":"x"}]}`
	if err := json.Unmarshal([]byte(raw2), &tr); err != nil {
		t.Fatal(err)
	}
	scored := ComputeScores(append([]Topic(nil), tr.Topics...))
	if len(scored) != 1 || scored[0].Score != 0 {
		t.Fatalf("got %#v", scored)
	}
}

func TestStripRedirects(t *testing.T) {
	t.Parallel()
	a := &App{}
	// Wrapped URL where the real target is in named group baseUrl (percent-encoded).
	redirects := []Redirect{
		{Name: "test", Pattern: `^https://example\.com/r\?u=(?<baseUrl>https%3A%2F%2Fshop\.example%2Fpath)$`},
	}
	topics := []Topic{
		{Offer: Offer{Url: "https://example.com/r?u=https%3A%2F%2Fshop.example%2Fpath"}},
		{Offer: Offer{Url: ""}},
		{Offer: Offer{Url: "https://unmatched.com/"}},
	}
	got := a.stripRedirects(append([]Topic(nil), topics...), redirects)
	if got[0].Offer.Url != "https://shop.example/path" {
		t.Fatalf("offer url = %q", got[0].Offer.Url)
	}
	if got[1].Offer.Url != "" || got[2].Offer.Url != "https://unmatched.com/" {
		t.Fatalf("unexpected mutation: %#v", got)
	}

	t.Run("empty topics", func(t *testing.T) {
		t.Parallel()
		if len(a.stripRedirects(nil, redirects)) != 0 {
			t.Fatal("expected empty")
		}
	})
	t.Run("empty redirects", func(t *testing.T) {
		t.Parallel()
		in := []Topic{{Offer: Offer{Url: "https://x.com"}}}
		got := a.stripRedirects(append([]Topic(nil), in...), nil)
		if got[0].Offer.Url != in[0].Offer.Url {
			t.Fatalf("got %q", got[0].Offer.Url)
		}
	})
}
