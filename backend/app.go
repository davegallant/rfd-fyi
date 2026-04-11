package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dlclark/regexp2"
	_ "github.com/joho/godotenv/autoload"
	"github.com/rs/zerolog/log"

	utils "github.com/davegallant/rfd-fyi/pkg/utils"
)

//go:embed dist/*
var frontendFS embed.FS

type App struct {
	Mux        *http.ServeMux
	TopicsPath string

	// HTTPClient and RFDBaseURL are used by getDeals (defaults: http.DefaultClient, forums host).
	HTTPClient  *http.Client
	RFDBaseURL  string
	RedirectsURL string

	// TopicsResponseCache, when non-nil, serves identical bytes from memory until TTL expires.
	TopicsResponseCache *BytesTTLCache
	// ReadTopicsFile overrides os.ReadFile for tests (e.g. counting reads).
	ReadTopicsFile func(name string) ([]byte, error)
}

type Redirect struct {
	Name    string `json:"name"`
	Pattern string `json:"pattern"`
}

func (a *App) Initialize() {
	a.TopicsPath = utils.GetEnv("TOPICS_PATH", "./topics.json")

	// Ensure the directory for the topics file exists.
	if err := os.MkdirAll(filepath.Dir(a.TopicsPath), 0o755); err != nil {
		log.Fatal().Err(err).Msg("failed to create topics directory")
	}

	a.Mux = http.NewServeMux()
	a.initializeRoutes()
}

func (a *App) Run(httpPort string) {
	log.Info().Msgf("Running http on port %s", httpPort)
	if err := http.ListenAndServe(fmt.Sprintf(":%s", httpPort), a.Mux); err != nil {
		panic(err)
	}
}

func (a *App) initializeRoutes() {
	// Serve topics.json from disk.
	a.Mux.HandleFunc("/topics.json", a.serveTopics)

	// No-JavaScript HTML listing (same data as topics.json).
	a.Mux.HandleFunc("/html", a.serveHTMLList)

	// Serve embedded frontend SPA for everything else.
	distFS, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(distFS))
	a.Mux.Handle("/", spaHandler{staticHandler: fileServer, staticFS: distFS})
}

func (a *App) httpClient() *http.Client {
	if a.HTTPClient != nil {
		return a.HTTPClient
	}
	return http.DefaultClient
}

func (a *App) rfdBaseURL() string {
	if a.RFDBaseURL != "" {
		return strings.TrimSuffix(a.RFDBaseURL, "/")
	}
	return "https://forums.redflagdeals.com"
}

func (a *App) redirectsURL() string {
	if a.RedirectsURL != "" {
		return a.RedirectsURL
	}
	return "https://raw.githubusercontent.com/davegallant/rfd-redirect-stripper/main/redirects.json"
}

func (a *App) readTopicsFile(name string) ([]byte, error) {
	if a.ReadTopicsFile != nil {
		return a.ReadTopicsFile(name)
	}
	return os.ReadFile(name)
}

// serveTopics reads the topics JSON file from disk and serves it.
func (a *App) serveTopics(w http.ResponseWriter, r *http.Request) {
	if a.TopicsResponseCache != nil {
		if cached, ok := a.TopicsResponseCache.Get(time.Now()); ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(cached)
			return
		}
	}

	data, err := a.readTopicsFile(a.TopicsPath)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("[]"))
			return
		}
		http.Error(w, "failed to read topics", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if a.TopicsResponseCache != nil {
		a.TopicsResponseCache.Set(data, time.Now())
	}
	_, _ = w.Write(data)
}

// loadTopicsFromFile reads and unmarshals TOPICS_PATH. A missing file yields an empty slice and no error.
func (a *App) loadTopicsFromFile() ([]Topic, error) {
	data, err := a.readTopicsFile(a.TopicsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []Topic{}, nil
		}
		return nil, err
	}
	if len(data) == 0 {
		return []Topic{}, nil
	}
	var topics []Topic
	if err := json.Unmarshal(data, &topics); err != nil {
		return nil, err
	}
	return topics, nil
}

// spaHandler serves static files when they exist, otherwise falls back to
// index.html so that client-side routing works.
type spaHandler struct {
	staticHandler http.Handler
	staticFS      fs.FS
}

func (h spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path == "" {
		path = "index.html"
	}
	if _, err := fs.Stat(h.staticFS, path); err != nil {
		r.URL.Path = "/"
	}
	h.staticHandler.ServeHTTP(w, r)
}

func (a *App) refreshTopics() {
	for {
		log.Info().Msg("Refreshing topics")
		latestTopics := a.getDeals(9, 1, 6)

		if len(latestTopics) > 0 {
			latestTopics = DeduplicateTopics(latestTopics)
			latestTopics = ComputeScores(latestTopics)

			log.Info().Msg("Refreshing redirects")
			redirects := a.getRedirects()
			latestTopics = a.stripRedirects(latestTopics, redirects)

			a.writeTopics(latestTopics)
		}

		time.Sleep(time.Duration(rand.IntN(90-60+1)+60) * time.Second)
	}
}

// writeTopics atomically writes the topics JSON to disk.
func (a *App) writeTopics(topics []Topic) {
	data, err := json.Marshal(topics)
	if err != nil {
		log.Error().Err(err).Msg("failed to marshal topics")
		return
	}

	// Write to a temp file and rename for atomicity.
	tmpFile := a.TopicsPath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0o644); err != nil {
		log.Error().Err(err).Msg("failed to write topics temp file")
		return
	}
	if err := os.Rename(tmpFile, a.TopicsPath); err != nil {
		log.Error().Err(err).Msg("failed to rename topics file")
		return
	}

	log.Info().Msgf("Wrote %d topics to %s", len(topics), a.TopicsPath)
}

func (a *App) stripRedirects(t []Topic, redirects []Redirect) []Topic {
	for i := range t {
		if t[i].Offer.Url == "" {
			continue
		}

		var offerUrl = t[i].Offer.Url
		log.Debug().Msgf("Offer url is : %s", offerUrl)
		for _, r := range redirects {
			re := regexp2.MustCompile(r.Pattern, 0)
			if m, _ := re.FindStringMatch(offerUrl); m != nil {
				g := m.GroupByName("baseUrl")

				if g.Name != "baseUrl" {
					continue
				}
				decodedValue, err := url.QueryUnescape(g.String())
				if err != nil {
					log.Error().Msgf("%s", err)
					break
				}
				t[i].Offer.Url = decodedValue
				log.Debug().Msgf("Setting offer url to: %s", t[i].Offer.Url)

				break
			}
		}

	}
	return t
}

func (a *App) getDeals(id int, firstPage int, lastPage int) []Topic {

	var t []Topic
	client := a.httpClient()
	base := a.rfdBaseURL()

	for i := firstPage; i < lastPage; i++ {
		requestURL := fmt.Sprintf("%s/api/topics?forum_id=%d&per_page=40&page=%d", base, id, i)
		res, err := client.Get(requestURL)
		if err != nil {
			log.Warn().Msgf("error fetching deals: %s\n", err)
			continue
		}
		body, readErr := io.ReadAll(res.Body)
		_ = res.Body.Close()
		if readErr != nil {
			log.Warn().Msgf("could not read response body: %s\n", readErr)
			continue
		}
		if res.StatusCode != http.StatusOK {
			log.Warn().Msgf("unexpected status fetching deals: %d", res.StatusCode)
			continue
		}

		var response TopicsResponse
		if err := json.Unmarshal(body, &response); err != nil {
			log.Warn().Msgf("could not unmarshal response body: %s", err)
			continue
		}

		t = append(t, FilterNonSponsorTopics(response.Topics)...)
	}
	return t
}

func (a *App) getRedirects() []Redirect {
	requestURL := a.redirectsURL()
	res, err := a.httpClient().Get(requestURL)
	if err != nil {
		log.Warn().Msgf("error fetching redirects: %s\n", err)
		return nil
	}
	body, readErr := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if readErr != nil {
		log.Warn().Msgf("could not read response body: %s\n", readErr)
		return nil
	}
	if res.StatusCode != http.StatusOK {
		log.Warn().Msgf("unexpected status fetching redirects: %d", res.StatusCode)
		return nil
	}

	var r []Redirect
	if err := json.Unmarshal(body, &r); err != nil {
		log.Warn().Msgf("could not unmarshal response body: %s", err)
		return nil
	}

	return r
}
