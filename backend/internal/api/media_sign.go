package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"pargar/backend/internal/models"
)

// mediaSignWindow keeps one signature for a stretch of time. The same object
// then keeps the same URL, so clients do not reload a photo that did not change.
const mediaSignWindow = 15 * time.Minute

func stableMediaExpiry(now time.Time, ttl, window time.Duration) int64 {
	if window <= 0 {
		window = mediaSignWindow
	}
	if ttl < window {
		ttl = window
	}
	w := int64(window.Seconds())
	slot := now.Unix() / w
	return (slot+1)*w + int64(ttl.Seconds())
}

func (s *Server) signMediaURL(key string) string {
	key = strings.TrimPrefix(strings.TrimSpace(key), "/")
	if key == "" {
		return ""
	}
	exp := stableMediaExpiry(time.Now(), s.cfg.MediaURLTTL, mediaSignWindow)
	sig := mediaHMAC(s.cfg.JWTSecret, key, exp)
	return fmt.Sprintf("%s/media/%s?exp=%d&sig=%s",
		s.cfg.PublicURL,
		url.PathEscape(key),
		exp,
		sig,
	)
}

func (s *Server) signExistingMediaURL(raw string) string {
	if raw == "" {
		return ""
	}
	key := mediaKeyFromURL(raw)
	if key == "" {
		return raw
	}
	return s.signMediaURL(key)
}

func mediaKeyFromURL(raw string) string {
	if i := strings.Index(raw, "/media/"); i >= 0 {
		rest := raw[i+len("/media/"):]
		if q := strings.Index(rest, "?"); q >= 0 {
			rest = rest[:q]
		}
		key, err := url.PathUnescape(rest)
		if err != nil {
			return ""
		}
		return strings.TrimPrefix(key, "/")
	}
	return strings.TrimPrefix(raw, "/")
}

func mediaHMAC(secret, key string, exp int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%s:%d", key, exp)
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) verifyMediaSignature(key, expStr, sig string) bool {
	if key == "" || expStr == "" || sig == "" {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || exp < time.Now().Unix() {
		return false
	}
	expected := mediaHMAC(s.cfg.JWTSecret, key, exp)
	return hmac.Equal([]byte(expected), []byte(sig))
}

func (s *Server) signUserMedia(u *models.User) {
	if u == nil || u.AvatarPhoto == "" {
		return
	}
	key := mediaKeyFromURL(u.AvatarPhoto)
	if !mediaKeyOwnedByUser(key, u.ID) {
		// Refuse to mint signed URLs for foreign lesson/video keys stored as "avatar".
		u.AvatarPhoto = ""
		return
	}
	u.AvatarPhoto = s.signExistingMediaURL(u.AvatarPhoto)
}

// mediaKeyOwnedByUser reports whether key is a user-uploaded avatar/chat object.
func mediaKeyOwnedByUser(key string, userID int64) bool {
	key = strings.TrimPrefix(strings.TrimSpace(key), "/")
	if key == "" || strings.Contains(key, "..") {
		return false
	}
	uid := strconv.FormatInt(userID, 10)
	return strings.HasPrefix(key, "avatars/"+uid+"-") || strings.HasPrefix(key, "chats/"+uid+"-")
}
