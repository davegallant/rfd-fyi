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

	// Serve embedded frontend SPA for everything else.
	distFS, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(distFS))
	a.Mux.Handle("/", spaHandler{staticHandler: fileServer, staticFS: distFS})
}

// serveTopics reads the topics JSON file from disk and serves it.
func (a *App) serveTopics(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(a.TopicsPath)
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
	w.Write(data)
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
			latestTopics = a.deduplicateTopics(latestTopics)
			latestTopics = a.updateScores(latestTopics)

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

func (a *App) updateScores(t []Topic) []Topic {
	for i := range t {
		t[i].Score = t[i].Votes.Up - t[i].Votes.Down
	}
	return t
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

func (a *App) deduplicateTopics(topics []Topic) []Topic {
	seen := make(map[uint]bool)
	var deduplicated []Topic

	for _, topic := range topics {
		if !seen[topic.TopicID] {
			seen[topic.TopicID] = true
			deduplicated = append(deduplicated, topic)
		} else {
			log.Debug().Msgf("Removing duplicate topic: %d", topic.TopicID)
		}
	}

	return deduplicated
}

func (a *App) isSponsor(t Topic) bool {
	return strings.HasPrefix(t.Title, "[Sponsored]")
}

func (a *App) getDeals(id int, firstPage int, lastPage int) []Topic {

	var t []Topic

	for i := firstPage; i < lastPage; i++ {
		requestURL := fmt.Sprintf("https://forums.redflagdeals.com/api/topics?forum_id=%d&per_page=40&page=%d", id, i)
		res, err := http.Get(requestURL)
		if err != nil {
			log.Warn().Msgf("error fetching deals: %s\n", err)
		}
		body, err := io.ReadAll(res.Body)
		if err != nil {
			log.Warn().Msgf("could not read response body: %s\n", err)
		}

		var response TopicsResponse

		err = json.Unmarshal([]byte(body), &response)

		if err != nil {
			log.Warn().Msgf("could not unmarshal response body: %s", err)
		}

		for _, topic := range response.Topics {
			if a.isSponsor(topic) {
				continue
			}
			t = append(t, topic)
		}
	}
	return t
}

func (a *App) getRedirects() []Redirect {

	requestURL := fmt.Sprintf("https://raw.githubusercontent.com/davegallant/rfd-redirect-stripper/main/redirects.json")
	res, err := http.Get(requestURL)
	if err != nil {
		log.Warn().Msgf("error fetching redirects: %s\n", err)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		log.Warn().Msgf("could not read response body: %s\n", err)
	}

	var r []Redirect

	err = json.Unmarshal([]byte(body), &r)

	if err != nil {
		log.Warn().Msgf("could not unmarshal response body: %s", err)
	}

	return r
}
