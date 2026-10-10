package api

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/rs/cors"

	"pargar/backend/internal/config"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/service"
	"pargar/backend/internal/storage"
	"pargar/backend/internal/store"
)

type Server struct {
	cfg     *config.Config
	store   *store.Store
	redis   *redis.Client
	hub     *Hub
	watch   *service.WatchService
	hearts  *service.HeartsService
	notify  *service.Notifier
	storage storage.Storage
	auth    *AuthService
}

func NewServer(cfg *config.Config, st *store.Store, rdb *redis.Client, stg storage.Storage) *Server {
	hub := NewHub(rdb)
	hub.SetSeen(func(userID int64) {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = st.TouchLastSeen(ctx, userID)
	})
	notifier := service.NewNotifier(st, hub)
	trustedProxyConfig = cfg
	return &Server{
		cfg:     cfg,
		store:   st,
		redis:   rdb,
		hub:     hub,
		watch:   service.NewWatchService(st),
		hearts:  service.NewHeartsService(st, cfg),
		notify:  notifier,
		storage: stg,
		auth:    NewAuthService(cfg, st),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	router := newRouter(s)
	// Global per-IP limit on API routes. /api/health is short-circuited in ping()
	// before this mux, so probes are not counted or blocked.
	mux.Handle("/api/", s.globalAPIRateLimit(router))
	mux.HandleFunc("/media/", s.handleMedia)
	mux.Handle("/metrics", s.metricsAuth(observability.MetricsHandler()))

	c := cors.New(cors.Options{
		AllowedOrigins:   s.cfg.AllowedOrigins(),
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization", "X-Request-ID", "X-Metrics-Token"},
		ExposedHeaders:   []string{"Retry-After", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	})
	return c.Handler(s.recoverPanic(requestMiddleware(ping(mux))))
}

// metricsAuth requires METRICS_TOKEN (Bearer or X-Metrics-Token). When the token
// is unset outside DevMode, the endpoint is disabled (404) so it cannot be scraped.
func (s *Server) metricsAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		want := strings.TrimSpace(s.cfg.MetricsToken)
		if want == "" {
			if s.cfg.DevMode {
				next.ServeHTTP(w, r)
				return
			}
			http.NotFound(w, r)
			return
		}
		got := strings.TrimSpace(r.Header.Get("X-Metrics-Token"))
		if got == "" {
			auth := r.Header.Get("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				got = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
			}
		}
		if got == "" || got != want {
			writeErr(w, http.StatusUnauthorized, "دسترسی به متریک مجاز نیست")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
	key, err := url.PathUnescape(strings.TrimPrefix(r.URL.Path, "/media/"))
	if err != nil || key == "" || strings.Contains(key, "..") {
		http.NotFound(w, r)
		return
	}
	key = strings.TrimPrefix(key, "/")
	q := r.URL.Query()
	// Always require a valid signature — no cookie-only fallback (blocks easy link download).
	if !s.verifyMediaSignature(key, q.Get("exp"), q.Get("sig")) {
		writeErr(w, http.StatusUnauthorized, "دسترسی به رسانه مجاز نیست")
		return
	}
	if err := s.storage.Serve(w, r, key); err != nil {
		http.NotFound(w, r)
		return
	}
}

func (s *Server) handleSignMedia(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	key = strings.TrimPrefix(key, "/")
	if key == "" || strings.Contains(key, "..") {
		writeErr(w, http.StatusBadRequest, "کلید رسانه نامعتبر است")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": s.signMediaURL(key)})
}

func ping(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				observability.L().Error("panic",
					"error", rec,
					"path", r.URL.Path,
					"request_id", requestIDFromWriter(w),
				)
				writeErrCode(w, http.StatusInternalServerError, CodeInternal, "خطای داخلی سامانه")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) wsCheckOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser clients
	}
	origin = strings.TrimRight(origin, "/")
	for _, allowed := range s.cfg.AllowedOrigins() {
		if origin == allowed {
			return true
		}
	}
	return false
}

func (s *Server) newUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     s.wsCheckOrigin,
	}
}

func (s *Server) clientAddress(r *http.Request) string {
	return clientAddressTrusted(r, s.cfg)
}

// clientAddressTrusted returns the client IP. X-Real-IP / X-Forwarded-For are
// honoured only when the immediate TCP peer is in TrustedProxyCIDRs (Traefik must
// overwrite those headers). Otherwise RemoteAddr is used.
func clientAddressTrusted(r *http.Request, cfg *config.Config) string {
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	remoteIP := net.ParseIP(remoteHost)
	trusted := cfg != nil && cfg.IsTrustedProxy(remoteIP)

	if trusted {
		if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
			if ip := net.ParseIP(xri); ip != nil {
				return ip.String()
			}
			return xri
		}
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			for i := len(parts) - 1; i >= 0; i-- {
				ipStr := strings.TrimSpace(parts[i])
				if ipStr == "" {
					continue
				}
				if ip := net.ParseIP(ipStr); ip != nil {
					return ip.String()
				}
				return ipStr
			}
		}
	}
	if remoteHost != "" {
		return remoteHost
	}
	return r.RemoteAddr
}

// trustedProxyConfig is set by NewServer so package-level helpers honour the same CIDRs.
var trustedProxyConfig *config.Config

func clientAddress(r *http.Request) string {
	return clientAddressTrusted(r, trustedProxyConfig)
}

// SetTrustedProxyConfigForTest replaces the package-level proxy config (tests only).
func SetTrustedProxyConfigForTest(cfg *config.Config) (restore func()) {
	prev := trustedProxyConfig
	trustedProxyConfig = cfg
	return func() { trustedProxyConfig = prev }
}
