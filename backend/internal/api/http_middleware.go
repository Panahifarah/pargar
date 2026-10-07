package api

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"pargar/backend/internal/observability"
)

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Hijack unwraps the underlying ResponseWriter so WebSocket upgrades work.
// Without this, gorilla/websocket Upgrade fails with HTTP 500.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	// gorilla writes the 101 status line on the raw conn after Hijack, so
	// WriteHeader is never called — record Switching Protocols for access logs.
	if r.status == http.StatusOK {
		r.status = http.StatusSwitchingProtocols
	}
	return h.Hijack()
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func requestMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = newRequestID()
		}
		w.Header().Set("X-Request-ID", reqID)

		meta := &requestMeta{}
		ctx := context.WithValue(r.Context(), ctxMeta, meta)
		ctx, span := observability.StartSpan(ctx, r.Method+" "+routeLabel(r))
		defer span.End()
		r = r.WithContext(ctx)

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		path := routeLabel(r)
		observability.ObserveHTTP(r.Method, path, rec.status, time.Since(start))

		observability.L().Info("http",
			"request_id", reqID,
			"method", r.Method,
			"path", path,
			"status", rec.status,
			"duration_ms", observability.DurationMs(start),
			"user_id", meta.UserID,
			"remote", clientAddress(r),
		)
	})
}

func routeLabel(r *http.Request) string {
	p := r.URL.Path
	// Collapse numeric IDs and secret path tokens for cardinality-safe,
	// non-leaking metrics/access logs.
	parts := strings.Split(p, "/")
	for i, part := range parts {
		if part == "" {
			continue
		}
		prev := ""
		if i > 0 {
			prev = parts[i-1]
		}
		// Capability / invite tokens must never appear in logs or Prometheus labels.
		if prev == "chats" && i >= 2 && parts[i-2] == "exports" {
			parts[i] = "{token}"
			continue
		}
		if prev == "register-invite" {
			parts[i] = "{token}"
			continue
		}
		allDigit := true
		for _, c := range part {
			if c < '0' || c > '9' {
				allDigit = false
				break
			}
		}
		if allDigit {
			parts[i] = "{id}"
		}
	}
	return strings.Join(parts, "/")
}

func newRequestID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
