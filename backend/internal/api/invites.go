package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

func invitePublicPath(token string) string {
	return "/register/invite/" + token
}

func (s *Server) inviteURL(token string) string {
	base := strings.TrimRight(s.cfg.PublicURL, "/")
	if base == "" {
		return invitePublicPath(token)
	}
	return base + invitePublicPath(token)
}

func (s *Server) decorateInvite(inv *models.RegistrationInvite) {
	if inv == nil {
		return
	}
	enc := inv.Token
	inv.Token = ""
	if enc == "" {
		return
	}
	plain, err := store.DecryptInviteToken(s.cfg.JWTSecret, enc)
	if err != nil {
		return
	}
	inv.Token = plain
	inv.URL = s.inviteURL(plain)
}

func inviteErrorStatus(err error) (int, string) {
	switch {
	case errors.Is(err, store.ErrInviteNotFound), errors.Is(err, store.ErrInviteInvalid):
		return http.StatusNotFound, "لینک عضویت نامعتبر است"
	case errors.Is(err, store.ErrInvitePaused),
		errors.Is(err, store.ErrInviteRevoked),
		errors.Is(err, store.ErrInviteExhausted),
		errors.Is(err, store.ErrInviteExpired):
		// Generic message for public clients — do not reveal capacity or pause state.
		return http.StatusGone, "این لینک عضویت قابل استفاده نیست"
	default:
		return http.StatusInternalServerError, "بررسی لینک عضویت ممکن نشد"
	}
}

func (s *Server) handleGetRegisterInvite(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.PathValue("token"))
	if token == "" {
		writeErr(w, http.StatusBadRequest, "توکن نامعتبر است")
		return
	}
	inv, err := s.store.GetRegistrationInviteByTokenHash(r.Context(), store.HashInviteToken(token))
	if err != nil {
		code, msg := inviteErrorStatus(err)
		writeErr(w, code, msg)
		return
	}
	if err := store.EvaluateInviteAvailability(inv, time.Now()); err != nil {
		code, msg := inviteErrorStatus(err)
		writeErr(w, code, msg)
		return
	}
	out := map[string]any{"valid": true}
	if inv.Label != "" {
		out["label"] = inv.Label
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleRegisterInvite(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.PathValue("token"))
	if token == "" {
		writeErr(w, http.StatusBadRequest, "توکن نامعتبر است")
		return
	}

	inv, err := s.store.GetRegistrationInviteByTokenHash(r.Context(), store.HashInviteToken(token))
	if err != nil {
		code, msg := inviteErrorStatus(err)
		writeErr(w, code, msg)
		return
	}
	if err := store.EvaluateInviteAvailability(inv, time.Now()); err != nil {
		code, msg := inviteErrorStatus(err)
		writeErr(w, code, msg)
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
		s.recordAuthFailure(r.Context(), "register-invite", clientAddress(r))
		code, msg := captchaErrorMessage(err)
		writeErr(w, code, msg)
		return
	}
	inviteID := inv.ID
	if s.rejectIfBlacklisted(w, r, phone, "invite", &inviteID, username, email) {
		s.recordAuthFailure(r.Context(), "register-invite", clientAddress(r))
		return
	}

	ip, ok := s.registrationClientIP(w, r)
	if !ok {
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

	user, err := s.store.RegisterInviteStudent(
		r.Context(),
		inv.ID,
		name, email, username, hash, phone, secQ, answerHash, ip,
	)
	if err != nil {
		if errors.Is(err, store.ErrPhoneBlacklisted) {
			s.recordAuthFailure(r.Context(), "register-invite", ip)
			writeErr(w, http.StatusForbidden, "این شماره مجاز به ثبت‌نام نیست")
			return
		}
		if errors.Is(err, store.ErrRegistrationIPTaken) {
			writeErr(w, http.StatusConflict, "از این شبکه قبلاً ثبت‌نام انجام شده است")
			return
		}
		if errors.Is(err, store.ErrInviteRevoked) ||
			errors.Is(err, store.ErrInvitePaused) ||
			errors.Is(err, store.ErrInviteExhausted) ||
			errors.Is(err, store.ErrInviteExpired) ||
			errors.Is(err, store.ErrInviteInvalid) ||
			errors.Is(err, store.ErrInviteNotFound) {
			code, msg := inviteErrorStatus(err)
			writeErr(w, code, msg)
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
	s.clearAuthFailures(r.Context(), "register-invite", ip)
	observability.Logins.WithLabelValues("ok").Inc()
	observability.Activity("auth.register_invite", "user_id", user.ID, "invite_id", inv.ID, "remote", ip)
	s.signUserMedia(user)
	s.setSessionCookies(w, access, refresh, s.cfg.RefreshTokenTTL)
	writeJSON(w, http.StatusCreated, map[string]any{
		"accessToken": access, "refreshToken": refresh, "user": user,
	})
}

type createInviteRequest struct {
	MaxUses       int    `json:"maxUses"`
	Label         string `json:"label"`
	ExpiresInDays *int   `json:"expiresInDays"`
}

func (s *Server) handleAdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	var req createInviteRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if req.MaxUses < 1 || req.MaxUses > 10_000 {
		writeErr(w, http.StatusBadRequest, "ظرفیت باید بین ۱ تا ۱۰۰۰۰ باشد")
		return
	}
	label := strings.TrimSpace(req.Label)
	if msg := validateInviteLabel(label); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	var expiresAt *time.Time
	if req.ExpiresInDays != nil {
		days := *req.ExpiresInDays
		if days < 1 || days > 3650 {
			writeErr(w, http.StatusBadRequest, "مهلت باید بین ۱ تا ۳۶۵۰ روز باشد")
			return
		}
		t := time.Now().Add(time.Duration(days) * 24 * time.Hour)
		expiresAt = &t
	}

	raw, err := store.NewInviteToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ساخت توکن ممکن نشد")
		return
	}
	enc, err := store.EncryptInviteToken(s.cfg.JWTSecret, raw)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "رمزنگاری توکن ممکن نشد")
		return
	}

	admin := currentUser(r)
	inv, err := s.store.CreateRegistrationInvite(
		r.Context(),
		store.HashInviteToken(raw),
		enc,
		label,
		req.MaxUses,
		expiresAt,
		admin.ID,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیره لینک عضویت ممکن نشد")
		return
	}
	inv.Token = raw
	inv.URL = s.inviteURL(raw)
	observability.Activity("admin.invite_create", "invite_id", inv.ID, "max_uses", inv.MaxUses, "admin_id", admin.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"invite": inv})
}

func (s *Server) handleAdminListInvites(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	p := parsePageParams(r)
	invites, total, err := s.store.ListRegistrationInvites(r.Context(), q, p.PageSize, p.Offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری لینک‌های عضویت ممکن نشد")
		return
	}
	for i := range invites {
		s.decorateInvite(&invites[i])
	}
	writePage(w, invites, total, p)
}

func (s *Server) handleAdminRevokeInvite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	inv, err := s.store.RevokeRegistrationInvite(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrInviteNotFound) {
			writeErr(w, http.StatusNotFound, "لینک عضویت یافت نشد")
			return
		}
		if errors.Is(err, store.ErrInviteInvalid) {
			s.decorateInvite(inv)
			writeJSON(w, http.StatusOK, map[string]any{"invite": inv, "alreadyInactive": true})
			return
		}
		writeErr(w, http.StatusInternalServerError, "لغو لینک ممکن نشد")
		return
	}
	s.decorateInvite(inv)
	observability.Activity("admin.invite_revoke", "invite_id", inv.ID, "admin_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"invite": inv})
}

func (s *Server) handleAdminPauseInvite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	inv, err := s.store.PauseRegistrationInvite(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrInviteNotFound) {
			writeErr(w, http.StatusNotFound, "لینک عضویت یافت نشد")
			return
		}
		if errors.Is(err, store.ErrInviteInvalid) {
			writeErr(w, http.StatusConflict, "فقط لینک فعال قابل توقف موقت است")
			return
		}
		writeErr(w, http.StatusInternalServerError, "توقف موقت لینک ممکن نشد")
		return
	}
	s.decorateInvite(inv)
	observability.Activity("admin.invite_pause", "invite_id", inv.ID, "admin_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"invite": inv})
}

func (s *Server) handleAdminResumeInvite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	inv, err := s.store.ResumeRegistrationInvite(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrInviteNotFound) {
			writeErr(w, http.StatusNotFound, "لینک عضویت یافت نشد")
			return
		}
		if errors.Is(err, store.ErrInviteExpired) {
			writeErr(w, http.StatusConflict, "مهلت این لینک به پایان رسیده است")
			return
		}
		if errors.Is(err, store.ErrInviteExhausted) {
			writeErr(w, http.StatusConflict, "ظرفیت این لینک تکمیل شده است")
			return
		}
		if errors.Is(err, store.ErrInviteInvalid) {
			writeErr(w, http.StatusConflict, "فقط لینک متوقف‌شده قابل ازسرگیری است")
			return
		}
		writeErr(w, http.StatusInternalServerError, "ازسرگیری لینک ممکن نشد")
		return
	}
	s.decorateInvite(inv)
	observability.Activity("admin.invite_resume", "invite_id", inv.ID, "admin_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"invite": inv})
}

type updateInviteRequest struct {
	Label         *string `json:"label"`
	MaxUses       *int    `json:"maxUses"`
	ExpiresInDays *int    `json:"expiresInDays"`
	ClearExpires  *bool   `json:"clearExpires"`
}

func (s *Server) handleAdminUpdateInvite(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(w, http.StatusBadRequest, "شناسه نامعتبر است")
		return
	}
	var req updateInviteRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if req.Label == nil && req.MaxUses == nil && req.ExpiresInDays == nil && req.ClearExpires == nil {
		writeErr(w, http.StatusBadRequest, "هیچ فیلدی برای ویرایش ارسال نشده است")
		return
	}
	if req.MaxUses != nil && (*req.MaxUses < 1 || *req.MaxUses > 10_000) {
		writeErr(w, http.StatusBadRequest, "ظرفیت باید بین ۱ تا ۱۰۰۰۰ باشد")
		return
	}
	var labelPtr *string
	if req.Label != nil {
		trimmed := strings.TrimSpace(*req.Label)
		if msg := validateInviteLabel(trimmed); msg != "" {
			writeErr(w, http.StatusBadRequest, msg)
			return
		}
		labelPtr = &trimmed
	}

	setExpires := false
	var expiresAt *time.Time
	if req.ClearExpires != nil && *req.ClearExpires {
		setExpires = true
		expiresAt = nil
	} else if req.ExpiresInDays != nil {
		days := *req.ExpiresInDays
		if days < 1 || days > 3650 {
			writeErr(w, http.StatusBadRequest, "مهلت باید بین ۱ تا ۳۶۵۰ روز باشد")
			return
		}
		t := time.Now().Add(time.Duration(days) * 24 * time.Hour)
		setExpires = true
		expiresAt = &t
	}

	inv, err := s.store.UpdateRegistrationInvite(r.Context(), id, labelPtr, req.MaxUses, setExpires, expiresAt)
	if err != nil {
		if errors.Is(err, store.ErrInviteNotFound) {
			writeErr(w, http.StatusNotFound, "لینک عضویت یافت نشد")
			return
		}
		if errors.Is(err, store.ErrInviteInvalid) {
			writeErr(w, http.StatusConflict, "لینک لغو یا تکمیل‌شده قابل ویرایش نیست")
			return
		}
		if errors.Is(err, store.ErrInviteMaxUsesTooLow) {
			writeErr(w, http.StatusBadRequest, "ظرفیت نمی‌تواند کمتر از تعداد استفاده‌شده باشد")
			return
		}
		if errors.Is(err, store.ErrInviteMaxUsesRange) {
			writeErr(w, http.StatusBadRequest, "ظرفیت باید بین ۱ تا ۱۰۰۰۰ باشد")
			return
		}
		writeErr(w, http.StatusInternalServerError, "ویرایش لینک ممکن نشد")
		return
	}
	s.decorateInvite(inv)
	observability.Activity("admin.invite_update", "invite_id", inv.ID, "admin_id", currentUser(r).ID)
	writeJSON(w, http.StatusOK, map[string]any{"invite": inv})
}
