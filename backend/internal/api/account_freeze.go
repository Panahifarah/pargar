package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

const (
	msgAccountClosedLogin = "حساب بسته شده است و ورود ممکن نیست"
	msgFreezeAlready      = "حساب همین حالا فریز است"
	msgAccountClosed      = "حساب بسته شده است"
	msgUnfreezeClosed     = "مهلت فریز تمام شده و لغو فریز ممکن نیست"
	msgUnfreezeNone       = "حساب فریز نیست"
	msgDeleteNotFrozen    = "حذف دائمی فقط برای حساب فریز یا بسته ممکن است"
)

// settleAccount writes closed_at when a freeze has passed the 30-day window.
func (s *Server) settleAccount(ctx context.Context, u *models.User) *models.User {
	if u == nil || u.ClosedAt != nil || u.FrozenAt == nil || !u.IsClosed {
		return u
	}
	next, err := s.store.MarkAccountClosed(ctx, u.ID)
	if err != nil || next == nil {
		return u
	}
	return next
}

func (s *Server) handleFreezeAccount(w http.ResponseWriter, r *http.Request) {
	me := s.settleAccount(r.Context(), currentUser(r))
	var req struct {
		CurrentPassword string `json:"currentPassword"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if strings.TrimSpace(req.CurrentPassword) == "" {
		writeErr(w, http.StatusBadRequest, "گذرواژه فعلی الزامی است")
		return
	}
	if !s.auth.CheckPassword(me.PasswordHash, req.CurrentPassword) {
		writeErr(w, http.StatusForbidden, "گذرواژه فعلی نادرست است")
		return
	}
	if me.IsClosed {
		writeErr(w, http.StatusConflict, msgAccountClosed)
		return
	}
	if me.IsFrozen {
		writeErr(w, http.StatusConflict, msgFreezeAlready)
		return
	}
	user, err := s.store.FreezeUser(r.Context(), me.ID)
	if err != nil {
		if errors.Is(err, store.ErrAccountClosed) {
			writeErr(w, http.StatusConflict, msgAccountClosed)
			return
		}
		if errors.Is(err, store.ErrAccountFrozen) {
			writeErr(w, http.StatusConflict, msgFreezeAlready)
			return
		}
		writeErr(w, http.StatusInternalServerError, "فریز حساب ممکن نشد")
		return
	}
	observability.Activity("account.frozen", "user_id", user.ID)
	s.signUserMedia(user)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleUnfreezeAccount(w http.ResponseWriter, r *http.Request) {
	me := s.settleAccount(r.Context(), currentUser(r))
	if me.IsClosed {
		writeErr(w, http.StatusConflict, msgUnfreezeClosed)
		return
	}
	if !me.IsFrozen {
		writeErr(w, http.StatusConflict, msgUnfreezeNone)
		return
	}
	user, err := s.store.UnfreezeUser(r.Context(), me.ID)
	if err != nil {
		if errors.Is(err, store.ErrAccountClosed) {
			_, _ = s.store.MarkAccountClosed(r.Context(), me.ID)
			writeErr(w, http.StatusConflict, msgUnfreezeClosed)
			return
		}
		if errors.Is(err, store.ErrAccountNotFrozen) {
			writeErr(w, http.StatusConflict, msgUnfreezeNone)
			return
		}
		writeErr(w, http.StatusInternalServerError, "لغو فریز ممکن نشد")
		return
	}
	observability.Activity("account.unfrozen", "user_id", user.ID)
	s.signUserMedia(user)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}
