package service

import (
	"context"
	"testing"

	"pargar/backend/internal/models"
)

func TestConsumeHeartsSkipsStaff(t *testing.T) {
	h := &HeartsService{}
	for _, role := range []models.Role{models.RoleAdmin, models.RoleMentor} {
		u := &models.User{ID: 1, Role: role, Hearts: 1, IsLocked: false}
		out, lost, err := h.ConsumeHearts(context.Background(), u, 3)
		if err != nil {
			t.Fatalf("%s: unexpected err %v", role, err)
		}
		if lost != 0 {
			t.Fatalf("%s: expected 0 hearts lost, got %d", role, lost)
		}
		if out.Hearts != 1 {
			t.Fatalf("%s: hearts should stay 1, got %d", role, out.Hearts)
		}
		if out.IsLocked {
			t.Fatalf("%s: staff must not lock", role)
		}
	}
}
