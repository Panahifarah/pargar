package api

import (
	"net/http"
	"strconv"

	"pargar/backend/internal/models"
)

func (s *Server) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	limit := 30
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	items, err := s.store.ListNotifications(r.Context(), u.ID, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری اعلان‌ها ممکن نشد")
		return
	}
	unread, _ := s.store.UnreadCount(r.Context(), u.ID)
	if items == nil {
		items = []models.Notification{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"notifications": items,
		"unread":        unread,
	})
}

func (s *Server) handleUnreadCount(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	n, err := s.store.UnreadCount(r.Context(), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "شمارش ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"unread": n})
}

func (s *Server) handleMarkRead(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	id := routeID(r, "id")
	if err := s.store.MarkRead(r.Context(), u.ID, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی اعلان ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMarkAllRead(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if err := s.store.MarkAllRead(r.Context(), u.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "به‌روزرسانی اعلان‌ها ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleGetPrefs(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	prefs, err := s.store.GetPrefs(r.Context(), u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "بارگذاری تنظیمات ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"prefs": prefs})
}

func (s *Server) handlePutPrefs(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var req models.NotificationPrefs
	if err := bodyJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "دادهٔ ارسالی نامعتبر است")
		return
	}
	p := &models.NotificationPrefs{
		UserID:       u.ID,
		Progress:     req.Progress,
		Gamification: req.Gamification,
		Mentor:       req.Mentor,
		Event:        req.Event,
	}
	if err := s.store.UpdatePrefs(r.Context(), p); err != nil {
		writeErr(w, http.StatusInternalServerError, "ذخیرهٔ تنظیمات ممکن نشد")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"prefs": p})
}
