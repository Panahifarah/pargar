package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"pargar/backend/internal/store"
)

func (s *Server) handlePublicProfile(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if id <= 0 {
		writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
		return
	}
	u, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "کاربر پیدا نشد")
			return
		}
		writeErr(w, http.StatusInternalServerError, "بارگذاری پروفایل ممکن نشد")
		return
	}
	u = s.settleAccount(r.Context(), u)
	s.signUserMedia(u)
	me := currentUser(r)
	extras, err := s.store.GetProfileExtras(r.Context(), u.ID)
	if err != nil {
		extras = store.ProfileExtras{}
	}
	full := me.ID == u.ID || me.Role.IsStaff()
	if !full && !extras.Public {
		writeJSON(w, http.StatusOK, map[string]any{
			"user": map[string]any{
				"id": u.ID, "name": u.Name, "role": u.Role,
				"avatarVariant": u.AvatarVariant, "avatarPalette": u.AvatarPalette, "avatarPhoto": u.AvatarPhoto,
				"private": true, "isFrozen": u.IsFrozen, "isClosed": u.IsClosed,
			},
		})
		return
	}
	view := map[string]any{
		"id": u.ID, "name": u.Name, "username": u.Username, "role": u.Role,
		"avatarVariant": u.AvatarVariant, "avatarPalette": u.AvatarPalette, "avatarPhoto": u.AvatarPhoto,
		"private": false, "public": extras.Public,
		"createdAt": u.CreatedAt,
		"isFrozen":  u.IsFrozen, "isClosed": u.IsClosed,
	}
	if full || extras.ShowStats {
		view["xp"] = u.XP
		view["hearts"] = u.Hearts
		view["streakCurrent"] = u.StreakCurrent
		view["streakLongest"] = u.StreakLongest
		view["isLocked"] = u.IsLocked
	}
	if full || extras.Public {
		view["banner"] = s.signExistingMediaURL(extras.Banner)
		links := extras.SocialLinks
		if len(links) == 0 {
			links = []byte(`[]`)
		}
		view["socialLinks"] = json.RawMessage(links)
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": view})
}
