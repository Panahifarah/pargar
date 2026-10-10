package api

import (
	"net/http"
)

func (s *Server) handleCommunity(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"socials": s.loadSocials(r.Context()),
	})
}
