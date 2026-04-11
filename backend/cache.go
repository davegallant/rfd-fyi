package main

import (
	"sync"
	"time"
)

// BytesTTLCache stores a JSON payload until TTL elapses. When App.TopicsResponseCache
// is nil, serveTopics does not use a TTL layer (behavior unchanged from file-only reads).
type BytesTTLCache struct {
	mu     sync.Mutex
	data   []byte
	expiry time.Time
	ttl    time.Duration
}

func NewBytesTTLCache(ttl time.Duration) *BytesTTLCache {
	return &BytesTTLCache{ttl: ttl}
}

func (c *BytesTTLCache) Set(data []byte, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data = append([]byte(nil), data...)
	c.expiry = now.Add(c.ttl)
}

// Get returns a copy of the cached data if it exists and has not expired.
func (c *BytesTTLCache) Get(now time.Time) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.expiry.IsZero() {
		return nil, false
	}
	if !now.Before(c.expiry) {
		return nil, false
	}
	return append([]byte(nil), c.data...), true
}
