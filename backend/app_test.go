package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestServeTopics_OKAndMissingFile(t *testing.T) {
	t.Parallel()
	t.Run("valid JSON file returns 200", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		path := filepath.Join(dir, "topics.json")
		want := []byte(`[{"topic_id":1,"title":"hi"}]`)
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
		a := &App{TopicsPath: path}
		rr := httptest.NewRecorder()
		a.serveTopics(rr, httptest.NewRequest(http.MethodGet, "/topics.json", nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("status %d", rr.Code)
		}
		if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
			t.Fatalf("Content-Type = %q", ct)
		}
		if string(rr.Body.Bytes()) != string(want) {
			t.Fatalf("body = %s", rr.Body.Bytes())
		}
	})
	t.Run("missing file returns empty array JSON", func(t *testing.T) {
		t.Parallel()
		a := &App{TopicsPath: filepath.Join(t.TempDir(), "nope.json")}
		rr := httptest.NewRecorder()
		a.serveTopics(rr, httptest.NewRequest(http.MethodGet, "/topics.json", nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("status %d", rr.Code)
		}
		if string(rr.Body.Bytes()) != "[]" {
			t.Fatalf("body = %s", rr.Body.Bytes())
		}
	})
	t.Run("read error returns 500", func(t *testing.T) {
		t.Parallel()
		a := &App{
			TopicsPath: "/unlikely/path/topics.json",
			ReadTopicsFile: func(string) ([]byte, error) {
				return nil, io.ErrUnexpectedEOF
			},
		}
		rr := httptest.NewRecorder()
		a.serveTopics(rr, httptest.NewRequest(http.MethodGet, "/topics.json", nil))
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("status %d", rr.Code)
		}
	})
}

func TestServeTopics_ResponseCacheSecondRequestNoFileRead(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "topics.json")
	payload := []byte(`[{"topic_id":1}]`)
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
	var reads atomic.Int32
	a := &App{
		TopicsPath:          path,
		TopicsResponseCache: NewBytesTTLCache(time.Minute),
		ReadTopicsFile: func(name string) ([]byte, error) {
			reads.Add(1)
			return os.ReadFile(name)
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/topics.json", nil)
	rr1 := httptest.NewRecorder()
	a.serveTopics(rr1, req)
	rr2 := httptest.NewRecorder()
	a.serveTopics(rr2, req)
	if reads.Load() != 1 {
		t.Fatalf("file reads = %d, want 1", reads.Load())
	}
	if rr1.Code != http.StatusOK || rr2.Code != http.StatusOK {
		t.Fatalf("codes %d %d", rr1.Code, rr2.Code)
	}
	if string(rr1.Body.Bytes()) != string(rr2.Body.Bytes()) {
		t.Fatal("bodies differ")
	}
}

func TestGetDeals_MockUpstream(t *testing.T) {
	t.Parallel()
	t.Run("200 returns topics JSON", func(t *testing.T) {
		t.Parallel()
		var upstreamCalls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			upstreamCalls.Add(1)
			if r.URL.Path != "/api/topics" {
				t.Errorf("path %q", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			resp := TopicsResponse{
				Topics: []Topic{
					{TopicID: 1, Title: "Deal", Votes: Votes{Up: 2, Down: 1}},
					{TopicID: 2, Title: "[Sponsored] skip"},
				},
			}
			_ = json.NewEncoder(w).Encode(resp)
		}))
		t.Cleanup(srv.Close)

		a := &App{
			RFDBaseURL: srv.URL,
			HTTPClient: srv.Client(),
		}
		got := a.getDeals(9, 1, 2)
		if len(got) != 1 || got[0].TopicID != 1 {
			t.Fatalf("got %#v", got)
		}
		if upstreamCalls.Load() != 1 {
			t.Fatalf("upstream calls = %d", upstreamCalls.Load())
		}
	})
	t.Run("multiple pages one call each", func(t *testing.T) {
		t.Parallel()
		var upstreamCalls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			upstreamCalls.Add(1)
			_ = json.NewEncoder(w).Encode(TopicsResponse{Topics: []Topic{{TopicID: uint(upstreamCalls.Load()), Title: "p"}}})
		}))
		t.Cleanup(srv.Close)
		a := &App{RFDBaseURL: srv.URL, HTTPClient: srv.Client()}
		got := a.getDeals(9, 1, 4)
		if len(got) != 3 {
			t.Fatalf("len = %d", len(got))
		}
		if upstreamCalls.Load() != 3 {
			t.Fatalf("calls = %d", upstreamCalls.Load())
		}
	})
	t.Run("upstream 500 yields no topics from that page", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		t.Cleanup(srv.Close)
		a := &App{RFDBaseURL: srv.URL, HTTPClient: srv.Client()}
		if got := a.getDeals(9, 1, 2); len(got) != 0 {
			t.Fatalf("got %#v", got)
		}
	})
	t.Run("client timeout returns empty", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(200 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
		}))
		t.Cleanup(srv.Close)
		client := srv.Client()
		client.Timeout = time.Millisecond
		a := &App{RFDBaseURL: srv.URL, HTTPClient: client}
		if got := a.getDeals(9, 1, 2); len(got) != 0 {
			t.Fatalf("got %#v", got)
		}
	})
}
