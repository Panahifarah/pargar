package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"pargar/backend/internal/config"
	"pargar/backend/internal/models"
	"pargar/backend/internal/observability"
	"pargar/backend/internal/store"
)

type AuthService struct {
	cfg   *config.Config
	store *store.Store
}

type Claims struct {
	UserID int64  `json:"uid"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

func NewAuthService(cfg *config.Config, st *store.Store) *AuthService {
	return &AuthService{cfg: cfg, store: st}
}

func (a *AuthService) SignAccess(user *models.User) (string, error) {
	claims := Claims{
		UserID: user.ID,
		Role:   user.Role.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(user.ID, 10),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(a.cfg.AccessTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(a.cfg.JWTSecret))
}

func (a *AuthService) SignRefresh() (string, string, error) {
	raw := make([]byte, 48)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token := hex.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(hash[:]), nil
}

func (a *AuthService) refreshTTL(rememberMe bool) time.Duration {
	if rememberMe {
		return a.cfg.RefreshTokenTTL
	}
	return a.cfg.RefreshTokenTTLSession
}

func (a *AuthService) IssueForUser(ctx context.Context, user *models.User) (access, refresh string, err error) {
	return a.IssueForUserTTL(ctx, user, a.cfg.RefreshTokenTTL)
}

func (a *AuthService) IssueForUserTTL(ctx context.Context, user *models.User, refreshTTL time.Duration) (access, refresh string, err error) {
	if refreshTTL <= 0 {
		refreshTTL = a.cfg.RefreshTokenTTLSession
	}
	access, err = a.SignAccess(user)
	if err != nil {
		return "", "", err
	}
	rt, hash, err := a.SignRefresh()
	if err != nil {
		return "", "", err
	}
	if err := a.store.CreateRefreshToken(ctx, user.ID, hash, time.Now().Add(refreshTTL)); err != nil {
		return "", "", err
	}
	return access, rt, nil
}

// Authenticate resolves a user from the Authorization header.
func (s *Server) Authenticate(r *http.Request) (*models.User, error) {
	tokenStr := accessTokenFromRequest(r)
	if tokenStr == "" {
		return nil, errors.New("توکن ورود ارسال نشده است")
	}
	user, err := s.auth.parseAndLoad(r.Context(), tokenStr)
	if err != nil {
		return nil, errors.New("توکن نامعتبر یا منقضی شده است")
	}
	return user, nil
}

func (a *AuthService) parseAndLoad(ctx context.Context, tokenStr string) (*models.User, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("روش امضای توکن نامعتبر است")
		}
		return []byte(a.cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("توکن نامعتبر است")
	}
	user, err := a.store.GetUserByID(ctx, claims.UserID)
	if err != nil {
		return nil, errors.New("توکن نامعتبر یا منقضی شده است")
	}
	if !user.IsActive {
		return nil, errors.New("حساب غیرفعال است")
	}
	return user, nil
}

func (a *AuthService) HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func (a *AuthService) CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

// ---- handlers ----

type credsRequest struct {
	Name          string `json:"name"`
	Email         string `json:"email"`    // legacy alias
	Username      string `json:"username"` // preferred login identifier
	Password      string `json:"password"`
	ChallengeID   string `json:"challengeId"`
	CaptchaAnswer string `json:"captchaAnswer"`
	RememberMe    bool   `json:"rememberMe"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req credsRequest
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	ip := clientAddress(r)
	if err := s.consumeCaptcha(r.Context(), req.ChallengeID, req.CaptchaAnswer); err != nil {
		s.recordAuthFailure(r.Context(), "login", ip)
		observability.Logins.WithLabelValues("captcha_fail").Inc()
		observability.Activity("auth.captcha_failed", "remote", ip)
		code, msg := captchaErrorMessage(err)
		writeErr(w, code, msg)
		return
	}
	login := strings.TrimSpace(req.Username)
	if login == "" {
		login = strings.TrimSpace(req.Email)
	}
	user, err := s.store.GetUserByLogin(r.Context(), login)
	if err != nil || !s.auth.CheckPassword(user.PasswordHash, req.Password) {
		s.recordAuthFailure(r.Context(), "login", ip)
		observability.Logins.WithLabelValues("fail").Inc()
		observability.Activity("auth.login_failed", "login", login, "remote", ip)
		writeErr(w, http.StatusUnauthorized, "شناسه کاربری یا گذرواژه نادرست است")
		return
	}
	if !user.IsActive {
		observability.Logins.WithLabelValues("inactive").Inc()
		writeErr(w, http.StatusForbidden, "حساب غیرفعال است")
		return
	}
	refreshTTL := s.auth.refreshTTL(req.RememberMe)
	access, refresh, err := s.auth.IssueForUserTTL(r.Context(), user, refreshTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "صدور نشست ورود ممکن نشد")
		return
	}
	if meta, ok := r.Context().Value(ctxMeta).(*requestMeta); ok && meta != nil {
		meta.UserID = user.ID
	}
	s.clearAuthFailures(r.Context(), "login", ip)
	observability.Logins.WithLabelValues("ok").Inc()
	observability.Activity("auth.login", "user_id", user.ID, "role", user.Role.String())
	s.signUserMedia(user)
	s.setSessionCookies(w, access, refresh, refreshTTL)
	writeJSON(w, http.StatusOK, map[string]any{
		"accessToken": access, "refreshToken": refresh, "user": user,
	})
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = bodyJSON(r, &req)
	refreshTok := refreshTokenFromRequest(r, req.RefreshToken)
	if refreshTok == "" {
		writeErr(w, http.StatusUnauthorized, "توکن نوسازی نامعتبر است")
		return
	}
	hash := sha256.Sum256([]byte(refreshTok))
	userID, lifetime, ok, err := s.store.ConsumeRefreshToken(r.Context(), hex.EncodeToString(hash[:]))
	if err != nil || !ok {
		s.clearSessionCookies(w)
		writeErr(w, http.StatusUnauthorized, "توکن نوسازی نامعتبر است")
		return
	}
	user, err := s.store.GetUserByID(r.Context(), userID)
	if err != nil {
		s.clearSessionCookies(w)
		writeErr(w, http.StatusUnauthorized, "توکن نوسازی نامعتبر است")
		return
	}
	if !user.IsActive {
		s.clearSessionCookies(w)
		writeErr(w, http.StatusUnauthorized, "حساب غیرفعال است")
		return
	}
	// Preserve remember-me vs short session when rotating the refresh token.
	ttl := s.cfg.RefreshTokenTTLSession
	if lifetime >= 48*time.Hour {
		ttl = s.cfg.RefreshTokenTTL
	}
	access, refresh, err := s.auth.IssueForUserTTL(r.Context(), user, ttl)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "صدور نشست ورود ممکن نشد")
		return
	}
	s.signUserMedia(user)
	s.setSessionCookies(w, access, refresh, ttl)
	writeJSON(w, http.StatusOK, map[string]any{
		"accessToken": access, "refreshToken": refresh, "user": user,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = bodyJSON(r, &req)
	refreshTok := refreshTokenFromRequest(r, req.RefreshToken)
	if refreshTok != "" {
		hash := sha256.Sum256([]byte(refreshTok))
		_ = s.store.RevokeRefreshToken(r.Context(), hex.EncodeToString(hash[:]))
	} else if u != nil {
		_ = s.store.RevokeAllUserRefreshTokens(r.Context(), u.ID)
	}
	s.clearSessionCookies(w)
	if u != nil {
		observability.Activity("auth.logout", "user_id", u.ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	hearts, _ := s.hearts.RefreshHearts(r.Context(), u)
	user, err := s.store.GetUserByID(r.Context(), hearts.ID)
	if err != nil {
		user = hearts
	}
	s.signUserMedia(user)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

var avatarVariants = map[string]bool{
	"marble": true, "beam": true, "pixel": true, "sunset": true, "ring": true, "bauhaus": true,
}

func (s *Server) handlePutAvatar(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req struct {
		Variant *string `json:"avatarVariant"`
		Palette *string `json:"avatarPalette"`
		Photo   *string `json:"avatarPhoto"`
	}
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if req.Variant != nil && !avatarVariants[*req.Variant] {
		writeErr(w, http.StatusBadRequest, "گونهٔ آواتار نامعتبر است")
		return
	}
	if req.Photo != nil && *req.Photo != "" {
		key := mediaKeyFromURL(*req.Photo)
		if !mediaKeyOwnedByUser(key, u.ID) {
			writeErr(w, http.StatusBadRequest, "نشانی تصویر آواتار نامعتبر است")
			return
		}
		// Persist without signature query.
		if q := strings.Index(*req.Photo, "?"); q >= 0 {
			stripped := (*req.Photo)[:q]
			req.Photo = &stripped
		}
	}
	user, err := s.store.UpdateAvatar(r.Context(), u.ID, req.Variant, req.Palette, req.Photo)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی آواتار ممکن نشد")
		return
	}
	s.signUserMedia(user)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleAvatarPhotoUpload(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	const maxAvatarSize = 6 << 20 // 6 MB
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarSize+1<<20)
	if err := r.ParseMultipartForm(maxAvatarSize + 1<<20); err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "حجم فایل بیش از حد مجاز است")
		return
	}
	file, h, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "فایل ارسال نشده است")
		return
	}
	defer file.Close()
	if h.Size > maxAvatarSize {
		writeErr(w, http.StatusRequestEntityTooLarge, "حجم فایل باید کمتر از ۶ مگابایت باشد")
		return
	}
	accepted, err := acceptAvatarImage(h, file)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	key := fmt.Sprintf("avatars/%d-%d%s", u.ID, time.Now().UnixNano(), accepted.Ext)
	rawURL, err := s.storage.Save(key, file, h.Size)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیرهٔ فایل ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"url": s.signExistingMediaURL(rawURL)})
}
