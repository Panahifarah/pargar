package api

import (
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
	s.signUserMedia(u)
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id":            u.ID,
			"name":          u.Name,
			"username":      u.Username,
			"role":          u.Role,
			"xp":            u.XP,
			"hearts":        u.Hearts,
			"streakCurrent": u.StreakCurrent,
			"streakLongest": u.StreakLongest,
			"avatarVariant": u.AvatarVariant,
			"avatarPalette": u.AvatarPalette,
			"avatarPhoto":   u.AvatarPhoto,
			"isLocked":      u.IsLocked,
		},
	})
}
