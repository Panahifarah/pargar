package api

import (
	"errors"
	"net/http"
	"strings"

	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

func (s *Server) settingTruthy(r *http.Request, key string, defaultTrue bool) bool {
	v, err := s.store.GetSetting(r.Context(), key)
	if err != nil || strings.TrimSpace(v) == "" {
		return defaultTrue
	}
	v = strings.TrimSpace(v)
	return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
}

func (s *Server) registrationEnabled(r *http.Request) bool {
	return s.settingTruthy(r, "registration_enabled", false)
}

func (s *Server) registrationRequireWhitelist(r *http.Request) bool {
	// Default ON: public signup must use an available whitelist phone.
	return s.settingTruthy(r, "registration_require_whitelist", true)
}

func (s *Server) handleRegisterStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":          s.registrationEnabled(r),
		"requireWhitelist": s.registrationRequireWhitelist(r),
	})
}

type registerRequest struct {
	Name             string `json:"name"`
	Email            string `json:"email"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	PasswordConfirm  string `json:"passwordConfirm"`
	Phone            string `json:"phone"`
	SecurityQuestion string `json:"securityQuestion"`
	SecurityAnswer   string `json:"securityAnswer"`
	ChallengeID      string `json:"challengeId"`
	CaptchaAnswer    string `json:"captchaAnswer"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if !s.registrationEnabled(r) {
		writeErr(w, http.StatusForbidden, "ثبت‌نام عمومی فعلاً غیرفعال است")
		return
	}

	var req registerRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}

	name := strings.TrimSpace(req.Name)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	username := strings.ToLower(strings.TrimSpace(req.Username))
	phone := normalizePhone(req.Phone)
	secQ := strings.TrimSpace(req.SecurityQuestion)
	secA := strings.TrimSpace(req.SecurityAnswer)

	if msg := validateStudentRegistrationFields(
		name, email, username, phone, req.Password, req.PasswordConfirm, secQ, secA,
	); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if err := s.consumeCaptcha(r.Context(), req.ChallengeID, req.CaptchaAnswer); err != nil {
		s.recordAuthFailure(r.Context(), "register", clientAddress(r))
		code, msg := captchaErrorMessage(err)
		writeErr(w, code, msg)
		return
	}
	if s.rejectIfBlacklisted(w, r, phone, "public", nil, username, email) {
		s.recordAuthFailure(r.Context(), "register", clientAddress(r))
		return
	}

	ip := clientAddress(r)
	if ip == "" || ip == "unknown" {
		writeErr(w, http.StatusBadRequest, "آدرس شبکه شناسایی نشد")
		return
	}
	if taken, err := s.store.HasRegistrationIP(r.Context(), ip); err != nil {
		writeErr(w, http.StatusInternalServerError, "بررسی محدودیت ثبت‌نام ممکن نشد")
		return
	} else if taken {
		writeErr(w, http.StatusConflict, "از این شبکه قبلاً ثبت‌نام انجام شده است")
		return
	}

	if _, err := s.store.GetUserByEmail(r.Context(), email); err == nil {
		writeErr(w, http.StatusConflict, "این ایمیل قبلاً ثبت شده است")
		return
	} else if err != store.ErrNotFound {
		writeErr(w, http.StatusInternalServerError, "بررسی ایمیل ممکن نشد")
		return
	}
	if _, err := s.store.GetUserByUsername(r.Context(), username); err == nil {
		writeErr(w, http.StatusConflict, "این شناسهٔ کاربری قبلاً گرفته شده است")
		return
	} else if err != store.ErrNotFound {
		writeErr(w, http.StatusInternalServerError, "بررسی شناسه کاربری ممکن نشد")
		return
	}
	if _, err := s.store.GetUserByPhone(r.Context(), phone); err == nil {
		writeErr(w, http.StatusConflict, "این شماره تلفن قبلاً ثبت شده است")
		return
	} else if err != store.ErrNotFound {
		writeErr(w, http.StatusInternalServerError, "بررسی شماره تلفن ممکن نشد")
		return
	}

	hash, err := s.auth.HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "پردازش گذرواژه ممکن نشد")
		return
	}
	answerHash, err := s.auth.HashPassword(strings.ToLower(secA))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "پردازش جواب امنیتی ممکن نشد")
		return
	}

	user, err := s.store.RegisterPublicStudent(
		r.Context(),
		name, email, username, hash, phone, secQ, answerHash, ip,
		s.registrationRequireWhitelist(r),
	)
	if err != nil {
		if errors.Is(err, store.ErrPhoneBlacklisted) {
			s.recordAuthFailure(r.Context(), "register", ip)
			writeErr(w, http.StatusForbidden, "این شماره مجاز به ثبت‌نام نیست")
			return
		}
		if errors.Is(err, store.ErrRegistrationIPTaken) {
			writeErr(w, http.StatusConflict, "از این شبکه قبلاً ثبت‌نام انجام شده است")
			return
		}
		if errors.Is(err, store.ErrWhitelistNotAllowed) {
			s.recordAuthFailure(r.Context(), "register", ip)
			writeErr(w, http.StatusForbidden, "این شماره در فهرست مجاز نیست")
			return
		}
		if errors.Is(err, store.ErrWhitelistConsumed) {
			writeErr(w, http.StatusConflict, "این شماره قبلاً استفاده شده")
			return
		}
		if store.IsUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "این اطلاعات قبلاً ثبت شده است")
			return
		}
		writeErr(w, http.StatusInternalServerError, "ثبت‌نام ممکن نشد")
		return
	}

	access, refresh, err := s.auth.IssueForUser(r.Context(), user)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "صدور نشست ورود ممکن نشد")
		return
	}
	if meta, ok := r.Context().Value(ctxMeta).(*requestMeta); ok && meta != nil {
		meta.UserID = user.ID
	}
	s.clearAuthFailures(r.Context(), "register", ip)
	observability.Logins.WithLabelValues("ok").Inc()
	observability.Activity("auth.register", "user_id", user.ID, "remote", ip)
	s.signUserMedia(user)
	s.setSessionCookies(w, access, refresh, s.cfg.RefreshTokenTTL)
	writeJSON(w, http.StatusCreated, map[string]any{
		"accessToken": access, "refreshToken": refresh, "user": user,
	})
}
