package api

import (
	"net/http"
	"strings"
	"time"
)

const (
	cookieAccess  = "pargar_access"
	cookieRefresh = "pargar_refresh"
)

func (s *Server) setSessionCookies(w http.ResponseWriter, access, refresh string, refreshTTL time.Duration) {
	secure := s.cfg.CookieSecure()
	http.SetCookie(w, &http.Cookie{
		Name:     cookieAccess,
		Value:    access,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(s.cfg.AccessTokenTTL.Seconds()),
	})
	maxAge := int(refreshTTL.Seconds())
	if maxAge <= 0 {
		maxAge = int((24 * time.Hour).Seconds())
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieRefresh,
		Value:    refresh,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func (s *Server) clearSessionCookies(w http.ResponseWriter) {
	secure := s.cfg.CookieSecure()
	expired := &http.Cookie{
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	}
	a := *expired
	a.Name = cookieAccess
	http.SetCookie(w, &a)
	r := *expired
	r.Name = cookieRefresh
	http.SetCookie(w, &r)
}

func accessTokenFromRequest(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	if c, err := r.Cookie(cookieAccess); err == nil && c.Value != "" {
		return c.Value
	}
	return ""
}

func refreshTokenFromRequest(r *http.Request, bodyToken string) string {
	if strings.TrimSpace(bodyToken) != "" {
		return strings.TrimSpace(bodyToken)
	}
	if c, err := r.Cookie(cookieRefresh); err == nil && c.Value != "" {
		return c.Value
	}
	return ""
}
