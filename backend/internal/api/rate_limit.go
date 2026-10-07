package api

import (
	"context"
	"net/http"
	"strconv"
	"time"
)

const (
	loginBaseLimit   int64 = 20
	refreshRateLimit int64 = 60
	// apiGlobalLimitDefault is generous for normal LMS polling/navigation (~4 req/s).
	apiGlobalLimitDefault int64 = 240
	uploadRateLimit       int64 = 20 // per-user chat/avatar uploads per minute
	wsHandshakeLimit      int64 = 30 // per-IP WS upgrades per minute
	chatExportRateLimit   int64 = 10 // per-IP external chat-export downloads per minute
	rateLimitWindow             = time.Minute
	authFailTTL                 = 15 * time.Minute
	apiGlobalRateMsg            = "تعداد درخواست‌ها زیاد است؛ لطفاً کمی صبر کنید"
	authRateMsg                 = "تعداد تلاش‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید"
)

// apiGlobalLimit is the per-IP budget for all /api/* routes (except /api/health).
// Mutable so tests can lower it without hammering Redis.
var apiGlobalLimit = apiGlobalLimitDefault

// wsHandshakeLimitVar is mutable for tests.
var wsHandshakeLimitVar = wsHandshakeLimit

// SetAPIGlobalLimitForTest overrides the global /api budget and returns the previous value.
func SetAPIGlobalLimitForTest(limit int64) (previous int64) {
	previous = apiGlobalLimit
	apiGlobalLimit = limit
	return previous
}

// SetWSHandshakeLimitForTest overrides the per-IP WS upgrade budget.
func SetWSHandshakeLimitForTest(limit int64) (previous int64) {
	previous = wsHandshakeLimitVar
	wsHandshakeLimitVar = limit
	return previous
}

// effectiveAuthLimit tightens the per-IP request budget after recent failures.
// Healthy clients (no failures) keep the full baseline.
func effectiveAuthLimit(base, failCount int64) int64 {
	switch {
	case failCount <= 0:
		return base
	case failCount <= 2:
		if base > 15 {
			return 15
		}
		return base
	case failCount <= 5:
		return 8
	case failCount <= 9:
		return 4
	default:
		return 2
	}
}

func authFailKey(scope, ip string) string {
	return "pargar:auth-fail:" + scope + ":" + ip
}

func authRateKey(scope, ip string) string {
	return "pargar:auth-rate:" + scope + ":" + ip
}

func apiRateKey(ip string) string {
	return "pargar:api-rate:" + ip
}

func uploadRateKey(userID int64) string {
	return "pargar:upload-rate:" + strconv.FormatInt(userID, 10)
}

func wsRateKey(ip string) string {
	return "pargar:ws-rate:" + ip
}

func chatExportRateKey(ip string) string {
	return "pargar:chat-export-rate:" + ip
}

// ipRateLimit caps a public surface per client IP (e.g. external chat export).
func (s *Server) ipRateLimit(limit int64, keyFn func(string) string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.redis == nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next(w, r)
			return
		}
		ip := clientAddress(r)
		if ip == "" {
			next(w, r)
			return
		}
		key := keyFn(ip)
		count, err := s.redis.Incr(r.Context(), key).Result()
		if err != nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next(w, r)
			return
		}
		if count == 1 {
			_ = s.redis.Expire(r.Context(), key, rateLimitWindow).Err()
		}
		if count > limit {
			w.Header().Set("Retry-After", strconv.Itoa(int(rateLimitWindow/time.Second)))
			writeErr(w, http.StatusTooManyRequests, apiGlobalRateMsg)
			return
		}
		next(w, r)
	}
}

func (s *Server) authFailCount(ctx context.Context, scope, ip string) int64 {
	if s.redis == nil {
		return 0
	}
	n, err := s.redis.Get(ctx, authFailKey(scope, ip)).Int64()
	if err != nil {
		return 0
	}
	return n
}

func (s *Server) recordAuthFailure(ctx context.Context, scope, ip string) {
	if s.redis == nil || ip == "" {
		return
	}
	key := authFailKey(scope, ip)
	n, err := s.redis.Incr(ctx, key).Result()
	if err != nil {
		return
	}
	if n == 1 {
		_ = s.redis.Expire(ctx, key, authFailTTL).Err()
	}
}

func (s *Server) clearAuthFailures(ctx context.Context, scope, ip string) {
	if s.redis == nil || ip == "" {
		return
	}
	// Drop both the failure streak and the short request window so a healthy
	// success restores full budget instead of leaving residual pressure.
	_ = s.redis.Del(ctx, authFailKey(scope, ip), authRateKey(scope, ip)).Err()
}

func (s *Server) authRateLimit(limit int64, scope string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.redis == nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next(w, r)
			return
		}
		ip := clientAddress(r)
		fails := s.authFailCount(r.Context(), scope, ip)
		effective := effectiveAuthLimit(limit, fails)
		key := authRateKey(scope, ip)
		count, err := s.redis.Incr(r.Context(), key).Result()
		if err != nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next(w, r)
			return
		}
		if count == 1 {
			_ = s.redis.Expire(r.Context(), key, rateLimitWindow).Err()
		}
		if count > effective {
			w.Header().Set("Retry-After", strconv.Itoa(int(rateLimitWindow/time.Second)))
			writeErr(w, http.StatusTooManyRequests, authRateMsg)
			return
		}
		next(w, r)
	}
}

// globalAPIRateLimit applies a generous per-IP sliding-window budget to /api/*.
// It never revokes tokens or locks accounts — only returns 429 + Retry-After.
// /api/ws is excluded: upgrades must not share the HTTP polling budget, and
// reconnect storms should not burn the same counter as REST calls.
func (s *Server) globalAPIRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/ws" {
			next.ServeHTTP(w, r)
			return
		}
		if s.redis == nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		ip := clientAddress(r)
		if ip == "" {
			next.ServeHTTP(w, r)
			return
		}
		key := apiRateKey(ip)
		count, err := s.redis.Incr(r.Context(), key).Result()
		if err != nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if count == 1 {
			_ = s.redis.Expire(r.Context(), key, rateLimitWindow).Err()
		}
		if count > apiGlobalLimit {
			w.Header().Set("Retry-After", strconv.Itoa(int(rateLimitWindow/time.Second)))
			writeErr(w, http.StatusTooManyRequests, apiGlobalRateMsg)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// perUserRateLimit caps authenticated abuse surfaces (uploads) per user id.
func (s *Server) perUserRateLimit(limit int64, scope string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := currentUser(r)
		if u == nil {
			writeErr(w, http.StatusUnauthorized, "نیاز به ورود دارید")
			return
		}
		if s.redis == nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next(w, r)
			return
		}
		key := uploadRateKey(u.ID)
		if scope != "upload" {
			key = "pargar:user-rate:" + scope + ":" + strconv.FormatInt(u.ID, 10)
		}
		count, err := s.redis.Incr(r.Context(), key).Result()
		if err != nil {
			if !s.cfg.DevMode {
				writeErr(w, http.StatusServiceUnavailable, "محدودیت نرخ در دسترس نیست")
				return
			}
			next(w, r)
			return
		}
		if count == 1 {
			_ = s.redis.Expire(r.Context(), key, rateLimitWindow).Err()
		}
		if count > limit {
			w.Header().Set("Retry-After", strconv.Itoa(int(rateLimitWindow/time.Second)))
			writeErr(w, http.StatusTooManyRequests, apiGlobalRateMsg)
			return
		}
		next(w, r)
	}
}

// allowWSHandshake enforces a per-IP budget on WebSocket upgrades.
// Returns false when the caller should receive 429 (already written by caller).
func (s *Server) allowWSHandshake(r *http.Request) bool {
	if s.redis == nil {
		return s.cfg.DevMode
	}
	ip := clientAddress(r)
	if ip == "" {
		return true
	}
	key := wsRateKey(ip)
	count, err := s.redis.Incr(r.Context(), key).Result()
	if err != nil {
		return s.cfg.DevMode
	}
	if count == 1 {
		_ = s.redis.Expire(r.Context(), key, rateLimitWindow).Err()
	}
	return count <= wsHandshakeLimitVar
}
