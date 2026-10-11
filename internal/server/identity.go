package server

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

func stamp() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func id() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
