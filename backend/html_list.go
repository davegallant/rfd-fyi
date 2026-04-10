package main

import (
	"cmp"
	"embed"
	"html/template"
	"net/http"
	"slices"

	"github.com/rs/zerolog/log"
)

//go:embed templates/*
var templatesFS embed.FS

var listHTMLTmpl = template.Must(template.ParseFS(templatesFS, "templates/list.html"))

type htmlListTopic struct {
	Title       string
	ThreadURL   string
	OfferURL    string
	DealerName  string
	Score       int
	HasOffer    bool
}

type htmlListData struct {
	Topics []htmlListTopic
}

const rfdForumBase = "https://forums.redflagdeals.com"

func (a *App) serveHTMLList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	topics, err := a.loadTopicsFromFile()
	if err != nil {
		log.Error().Err(err).Msg("failed to load topics for /html")
		http.Error(w, "failed to read topics", http.StatusInternalServerError)
		return
	}

	slices.SortFunc(topics, func(x, y Topic) int {
		return cmp.Compare(y.Score, x.Score)
	})

	rows := make([]htmlListTopic, 0, len(topics))
	for _, t := range topics {
		row := htmlListTopic{
			Title:      t.Title,
			ThreadURL:  rfdForumBase + t.WebPath,
			Score:      t.Score,
			OfferURL:   t.Offer.Url,
			DealerName: t.Offer.DealerName,
			HasOffer:   t.Offer.Url != "",
		}
		rows = append(rows, row)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if err := listHTMLTmpl.Execute(w, htmlListData{Topics: rows}); err != nil {
		log.Error().Err(err).Msg("failed to render /html template")
	}
}
