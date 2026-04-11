package main

import (
	"testing"
	"time"
)

func TestBytesTTLCache(t *testing.T) {
	t.Parallel()
	t.Run("miss before set", func(t *testing.T) {
		t.Parallel()
		c := NewBytesTTLCache(time.Minute)
		now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
		if _, ok := c.Get(now); ok {
			t.Fatal("expected miss")
		}
	})
	t.Run("set then get returns value", func(t *testing.T) {
		t.Parallel()
		c := NewBytesTTLCache(time.Minute)
		now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
		want := []byte(`{"x":1}`)
		c.Set(want, now)
		got, ok := c.Get(now.Add(time.Second))
		if !ok {
			t.Fatal("expected hit")
		}
		if string(got) != string(want) {
			t.Fatalf("got %s want %s", got, want)
		}
	})
	t.Run("expired entry is miss", func(t *testing.T) {
		t.Parallel()
		c := NewBytesTTLCache(time.Millisecond)
		now := time.Now()
		c.Set([]byte(`ok`), now)
		time.Sleep(5 * time.Millisecond)
		if _, ok := c.Get(time.Now()); ok {
			t.Fatal("expected miss after TTL")
		}
	})
	t.Run("get returns copy", func(t *testing.T) {
		t.Parallel()
		c := NewBytesTTLCache(time.Minute)
		now := time.Now()
		c.Set([]byte(`a`), now)
		b, _ := c.Get(now)
		b[0] = 'z'
		b2, _ := c.Get(now)
		if string(b2) != "a" {
			t.Fatalf("cache mutated: %q", b2)
		}
	})
}
