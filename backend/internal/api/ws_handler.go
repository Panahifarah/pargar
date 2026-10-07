package api

import (
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

const wsBearerProtocol = "bearer"

// extractWSToken resolves the access token without putting it in the query string.
// Preference order: Authorization Bearer → Sec-WebSocket-Protocol → httpOnly cookie.
func extractWSToken(r *http.Request) (token string, selectedProtocol string) {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")), ""
	}

	protocols := websocket.Subprotocols(r)
	for i, p := range protocols {
		p = strings.TrimSpace(p)
		if p == wsBearerProtocol && i+1 < len(protocols) {
			next := strings.TrimSpace(protocols[i+1])
			if next != "" {
				return next, wsBearerProtocol
			}
		}
		if strings.HasPrefix(p, wsBearerProtocol+".") {
			tok := strings.TrimPrefix(p, wsBearerProtocol+".")
			if tok != "" {
				// Negotiate the bare "bearer" name so the JWT is not echoed in the response.
				return tok, wsBearerProtocol
			}
		}
	}

	if c, err := r.Cookie(cookieAccess); err == nil && c.Value != "" {
		return c.Value, ""
	}

	// Query-string tokens are rejected — JWTs in URLs end up in proxy/access logs.
	return "", ""
}

// handleWS upgrades to a websocket authenticated via Bearer header or
// Sec-WebSocket-Protocol (bearer + token).
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !s.allowWSHandshake(r) {
		w.Header().Set("Retry-After", "60")
		writeErr(w, http.StatusTooManyRequests, authRateMsg)
		return
	}

	token, selectedProtocol := extractWSToken(r)
	if token == "" {
		writeErr(w, http.StatusUnauthorized, "توکن ارسال نشده است")
		return
	}
	user, err := s.auth.parseAndLoad(r.Context(), token)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "توکن نامعتبر است")
		return
	}
	if meta, ok := r.Context().Value(ctxMeta).(*requestMeta); ok && meta != nil {
		meta.UserID = user.ID
	}

	upgrader := s.newUpgrader()
	if selectedProtocol != "" {
		upgrader.Subprotocols = []string{selectedProtocol}
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := s.hub.Register(user.ID, conn)

	// send a welcome frame so clients know the socket is live
	c.send <- []byte(`{"type":"connected"}`)
}
