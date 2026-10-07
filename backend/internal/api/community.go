package api

import (
	"context"
	"net/http"
	"strings"

	"pargar/backend/internal/models"
)

func (s *Server) handleCommunity(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	donationEnabled := s.cfg.DonationEnabled
	if v, err := s.store.GetSetting(ctx, "donation_enabled"); err == nil {
		donationEnabled = v == "true" || v == "1"
	}
	note := s.cfg.DonationNote
	if v, err := s.store.GetSetting(ctx, "donation_note"); err == nil && strings.TrimSpace(v) != "" {
		note = strings.TrimSpace(v)
	}
	if strings.TrimSpace(note) == "" {
		note = "اگر مایلید از مسیر حمایت کنید، وارد شوید و در گفتگو با تیم هماهنگ کنید — جزئیات فقط خصوصی رد و بدل می‌شود."
	}

	var contactID any
	if u, err := s.Authenticate(r); err == nil && u != nil {
		if id := s.donationContactID(ctx, u); id > 0 {
			contactID = id
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"donation": map[string]any{
			"enabled":   donationEnabled,
			"note":      note,
			"mode":      "chat",
			"contactId": contactID,
			"draft":     "سلام؛ دربارهٔ حمایت مالی / دونیت هماهنگ کنیم.",
		},
	})
}

func (s *Server) donationContactID(ctx context.Context, actor *models.User) int64 {
	staff, err := s.store.ListMentors(ctx)
	if err != nil {
		return 0
	}
	var adminID, mentorID int64
	for _, m := range staff {
		if m.ID == actor.ID {
			continue
		}
		if m.Role == models.RoleAdmin && adminID == 0 {
			adminID = m.ID
		}
		if m.Role == models.RoleMentor && mentorID == 0 {
			mentorID = m.ID
		}
	}
	if adminID != 0 {
		return adminID
	}
	return mentorID
}
