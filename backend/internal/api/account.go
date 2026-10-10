package api

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"pargar/backend/internal/store"
)

const msgUsernameCooldown = "سقف سه تغییر نام کاربری پر شده است. تا پایان مهلت نمی‌توانید دوباره نام کاربری را عوض کنید."

func (s *Server) handleUpdateUsername(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if strings.TrimSpace(req.Password) != "" {
		writeErr(w, http.StatusBadRequest, "تغییر گذرواژه از این مسیر ممکن نیست")
		return
	}
	username := strings.ToLower(strings.TrimSpace(req.Username))
	if username == "" {
		writeErr(w, http.StatusBadRequest, "شناسه کاربری الزامی است")
		return
	}
	if !validUsername(username) {
		writeErr(w, http.StatusBadRequest, msgUsernameInvalid)
		return
	}
	user, err := s.store.ChangeUsername(r.Context(), me.ID, username, time.Now())
	if err != nil {
		var cool *store.UsernameCooldownError
		if errors.As(err, &cool) {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error":                    msgUsernameCooldown,
				"code":                     "username_cooldown",
				"requestId":                requestIDFromWriter(w),
				"usernameCooldownUntil":    cool.Until,
				"usernameChangesRemaining": 0,
			})
			return
		}
		if errors.Is(err, store.ErrUsernameTaken) {
			writeErr(w, http.StatusConflict, "این شناسه قبلاً گرفته شده است")
			return
		}
		writeErr(w, http.StatusInternalServerError, "تغییر نام کاربری ممکن نشد")
		return
	}
	s.signUserMedia(user)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":                     user,
		"usernameChangesRemaining": user.UsernameChangesRemaining,
		"usernameCooldownUntil":    user.UsernameCooldownUntil,
	})
}

func (s *Server) handleUpdateAccount(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var req struct {
		CurrentPassword string  `json:"currentPassword"`
		Password        string  `json:"password"`
		Phone           *string `json:"phone"`
		Name            *string `json:"name"`
		Email           *string `json:"email"`
		Role            *string `json:"role"`
		Username        *string `json:"username"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if req.Role != nil && strings.TrimSpace(*req.Role) != me.Role.String() {
		writeErr(w, http.StatusForbidden, "نقش از این مسیر تغییر نمی‌کند")
		return
	}
	if req.Username != nil {
		next := strings.ToLower(strings.TrimSpace(*req.Username))
		if next != "" && next != strings.ToLower(me.Username) {
			writeErr(w, http.StatusBadRequest, "نام کاربری از این مسیر تغییر نمی‌کند")
			return
		}
	}

	hash := ""
	changingPassword := strings.TrimSpace(req.Password) != ""
	if changingPassword {
		if !s.auth.CheckPassword(me.PasswordHash, req.CurrentPassword) {
			writeErr(w, http.StatusForbidden, "گذرواژه فعلی نادرست است")
			return
		}
		if utf8.RuneCountInString(req.Password) < minPasswordLen {
			writeErr(w, http.StatusBadRequest, msgPasswordShort)
			return
		}
		if len(req.Password) > maxPasswordLen {
			writeErr(w, http.StatusBadRequest, msgPasswordLong)
			return
		}
		var err error
		hash, err = s.auth.HashPassword(req.Password)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "تغییر گذرواژه ممکن نشد")
			return
		}
	}

	name := ""
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if msg := validatePersonName(name); msg != "" {
			writeErr(w, http.StatusBadRequest, msg)
			return
		}
	}

	email := ""
	if req.Email != nil {
		email = strings.ToLower(strings.TrimSpace(*req.Email))
		if !validEmail(email) {
			writeErr(w, http.StatusBadRequest, msgEmailInvalid)
			return
		}
		if !strings.EqualFold(email, me.Email) {
			if _, err := s.store.GetUserByEmail(r.Context(), email); err == nil {
				writeErr(w, http.StatusConflict, "این ایمیل قبلاً ثبت شده است")
				return
			} else if !errors.Is(err, store.ErrNotFound) {
				writeErr(w, http.StatusInternalServerError, "ذخیره حساب ممکن نشد")
				return
			}
		}
	}

	phone := me.Phone
	if req.Phone != nil {
		phone = normalizePhone(*req.Phone)
		if !validPhone(phone) {
			writeErr(w, http.StatusBadRequest, msgPhoneInvalid)
			return
		}
		if phone != "" && phone != me.Phone {
			if _, err := s.store.GetUserByPhone(r.Context(), phone); err == nil {
				writeErr(w, http.StatusConflict, "این شماره تلفن قبلاً ثبت شده است")
				return
			} else if !errors.Is(err, store.ErrNotFound) {
				writeErr(w, http.StatusInternalServerError, "ذخیره حساب ممکن نشد")
				return
			}
		}
	}

	user, err := s.store.UpdateUser(r.Context(), me.ID, name, email, "", hash, phone, "", "", me.Role, me.Hearts, me.XP)
	if err != nil {
		if store.IsUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "این مقدار قبلاً ثبت شده است")
			return
		}
		writeErr(w, http.StatusInternalServerError, "ذخیره حساب ممکن نشد")
		return
	}
	s.signUserMedia(user)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}
