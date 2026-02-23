package main

import (
	"os"

	_ "github.com/joho/godotenv/autoload"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	utils "github.com/davegallant/rfd-fyi/pkg/utils"
)

func main() {
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	a := &App{}

	httpPort := utils.GetEnv("HTTP_PORT", "8080")

	a.Initialize()

	go a.refreshTopics()
	a.Run(httpPort)
}
