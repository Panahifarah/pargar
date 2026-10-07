package api

import (
	"context"
	"encoding/json"
	"net/http"

	"pargar/backend/internal/models"
	"pargar/backend/internal/service"
)

type ctxKey int

const (
	ctxUser ctxKey = iota
	ctxMeta
)

// requestMeta is shared across middleware and auth so access logs can include user_id.
type requestMeta struct {
	UserID int64
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// requireAuth resolves the caller from the Bearer token and stores the user in context.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := s.Authenticate(r)
		if err != nil {
			writeErrCode(w, http.StatusUnauthorized, CodeUnauthorized, err.Error())
			return
		}
		if meta, ok := r.Context().Value(ctxMeta).(*requestMeta); ok && meta != nil {
			meta.UserID = u.ID
		}
		ctx := context.WithValue(r.Context(), ctxUser, u)
		next(w, r.WithContext(ctx))
	}
}

// requireRole wraps requireAuth and enforces a minimum role.
func (s *Server) requireRole(roles ...models.Role) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
			u := currentUser(r)
			if u == nil {
				writeErr(w, http.StatusUnauthorized, "نیاز به ورود دارید")
				return
			}
			allowed := false
			for _, role := range roles {
				if u.Role == role {
					allowed = true
					break
				}
			}
			if !allowed {
				writeErr(w, http.StatusForbidden, "دسترسی کافی ندارید")
				return
			}
			next(w, r)
		})
	}
}

func currentUser(r *http.Request) *models.User {
	u, _ := r.Context().Value(ctxUser).(*models.User)
	return u
}

func (s *Server) lockedEnforce(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := currentUser(r)
		if u != nil && u.IsLocked && !u.Role.IsStaff() {
			writeErrCode(w, http.StatusLocked, CodeLocked, service.ErrLocked.Error())
			return
		}
		next(w, r)
	}
}

// bodyJSON decodes a JSON request body into v.
func bodyJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}
