package service

import (
	"context"
	"time"

	"pargar/backend/internal/config"
	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

// HeartsService manages the fixed 3-heart pool and lockout.
// Hearts do not regenerate over time — only a mentor/admin unlock restores them.
type HeartsService struct {
	store *store.Store
}

func NewHeartsService(st *store.Store, _ *config.Config) *HeartsService {
	return &HeartsService{store: st}
}

// RefreshHearts is a no-op kept for call-site compatibility.
// The game has no timed heart refill; the stored count is authoritative.
func (h *HeartsService) RefreshHearts(_ context.Context, u *models.User) (*models.User, error) {
	return u, nil
}

// ConsumeHearts decrements hearts for wrong answers; locks the account at 0.
// Admin and mentor accounts have infinite hearts and are never locked by this path.
// Returns the updated user and how many hearts were lost.
func (h *HeartsService) ConsumeHearts(ctx context.Context, u *models.User, loss int) (*models.User, int, error) {
	if u.Role.IsStaff() {
		return u, 0, nil
	}
	if loss < 0 {
		loss = 0
	}
	prev := u.Hearts
	cur := prev - loss
	if cur < 0 {
		cur = 0
	}
	actualLost := prev - cur
	if err := h.store.SetHearts(ctx, u.ID, cur); err != nil {
		return nil, 0, err
	}
	u.Hearts = cur
	if cur == 0 && !u.IsLocked {
		locked, err := h.store.LockUser(ctx, u.ID)
		if err != nil {
			return nil, 0, err
		}
		return locked, actualLost, nil
	}
	return u, actualLost, nil
}

// Streak logic keyed on activity date.
func UpdateStreak(ctx context.Context, st *store.Store, u *models.User) (*models.User, error) {
	today := time.Now()
	current, err := st.GetUserByID(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	streak := current.StreakCurrent
	longest := current.StreakLongest
	if current.LastActivityDate != nil {
		last := time.Date(current.LastActivityDate.Year(), current.LastActivityDate.Month(), current.LastActivityDate.Day(), 0, 0, 0, 0, time.UTC)
		todayDate := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
		diff := int(todayDate.Sub(last).Hours() / 24)
		switch {
		case diff == 0:
			// already active today
			return current, nil
		case diff == 1:
			streak++
		default:
			streak = 1
		}
	} else {
		streak = 1
	}
	if streak > longest {
		longest = streak
	}
	lastDate := today
	if err := st.UpdateStreakOnly(ctx, current.ID, streak, longest, &lastDate); err != nil {
		return nil, err
	}
	current.StreakCurrent = streak
	current.StreakLongest = longest
	current.LastActivityDate = &lastDate
	return current, nil
}
