package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

func (s *Server) handleListChallenges(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	list, err := s.store.ListActiveChallengesForUser(r.Context(), u.ID)
	if err != nil {
		writeInternalErr(w, "challenges.list", err, "بارگذاری چالش‌ها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"challenges": list})
}

func (s *Server) handleAdminListChallenges(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListChallengesAdmin(r.Context())
	if err != nil {
		writeInternalErr(w, "admin.challenges.list", err, "بارگذاری چالش‌ها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"challenges": list})
}

func (s *Server) handleAdminCreateChallenge(w http.ResponseWriter, r *http.Request) {
	admin := currentUser(r)
	var c models.Challenge
	if err := bodyJSON(r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if msg := validateChallenge(&c); msg != "" {
		writeValidationErr(w, msg)
		return
	}
	c.CreatedBy = &admin.ID
	id, err := s.store.CreateChallenge(r.Context(), &c)
	if err != nil {
		writeInternalErr(w, "admin.challenges.create", err, "ساخت چالش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"challenge": c, "id": id})
}

func (s *Server) handleAdminUpdateChallenge(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	var c models.Challenge
	if err := bodyJSON(r, &c); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	if msg := validateChallenge(&c); msg != "" {
		writeValidationErr(w, msg)
		return
	}
	if err := s.store.UpdateChallenge(r.Context(), id, &c); err != nil {
		if err == store.ErrNotFound {
			writeErr(w, http.StatusNotFound, "چالش پیدا نشد")
			return
		}
		writeInternalErr(w, "admin.challenges.update", err, "به‌روزرسانی چالش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminDeleteChallenge(w http.ResponseWriter, r *http.Request) {
	id := routeID(r, "id")
	if err := s.store.DeleteChallenge(r.Context(), id); err != nil {
		if err == store.ErrNotFound {
			writeErr(w, http.StatusNotFound, "چالش پیدا نشد")
			return
		}
		writeInternalErr(w, "admin.challenges.delete", err, "حذف چالش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func validateChallenge(c *models.Challenge) string {
	c.Title = strings.TrimSpace(c.Title)
	c.Description = strings.TrimSpace(c.Description)
	if c.Title == "" || c.StartsAt.IsZero() || c.EndsAt.IsZero() {
		return "عنوان، زمان شروع و زمان پایان الزامی هستند"
	}
	if utf8.RuneCountInString(c.Title) > 200 {
		return "عنوان چالش خیلی طولانی است"
	}
	if utf8.RuneCountInString(c.Description) > 5000 {
		return "توضیح چالش خیلی طولانی است"
	}
	if c.TargetXP <= 0 {
		return "هدف امتیاز باید بزرگ‌تر از صفر باشد"
	}
	if c.TargetXP > 1_000_000 {
		return "هدف امتیاز خیلی بزرگ است"
	}
	if c.EndsAt.Before(c.StartsAt) {
		return "زمان پایان باید پس از زمان شروع باشد"
	}
	return ""
}
