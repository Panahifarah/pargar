package service

import (
	"context"
	"strconv"
	"time"

	"pargar/backend/internal/config"
	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

// HeartsService manages a regenerating heart pool.
// Reaching zero waits for the next heart unless an admin turns lock-on-empty on.
type HeartsService struct {
	store *store.Store
}

type HeartPolicy struct {
	Max       int
	Every     time.Duration
	LockEmpty bool
}

func NewHeartsService(st *store.Store, _ *config.Config) *HeartsService {
	return &HeartsService{store: st}
}

func (h *HeartsService) Policy(ctx context.Context) HeartPolicy {
	p := HeartPolicy{Max: store.MaxHearts, Every: 4 * time.Hour, LockEmpty: false}
	if v, err := h.store.GetSetting(ctx, "hearts_max"); err == nil {
		if n, convErr := strconv.Atoi(v); convErr == nil && n >= 1 && n <= store.MaxHearts {
			p.Max = n
		}
	}
	if v, err := h.store.GetSetting(ctx, "hearts_regen_minutes"); err == nil {
		if n, convErr := strconv.Atoi(v); convErr == nil && n >= 5 && n <= 24*60 {
			p.Every = time.Duration(n) * time.Minute
		}
	}
	if v, err := h.store.GetSetting(ctx, "hearts_lock_on_empty"); err == nil {
		p.LockEmpty = v == "true" || v == "1"
	}
	return p
}

// RefreshHearts adds hearts that have come due since hearts_updated_at.
func (h *HeartsService) RefreshHearts(ctx context.Context, u *models.User) (*models.User, error) {
	if u == nil || u.Role.IsStaff() {
		return u, nil
	}
	p := h.Policy(ctx)
	if u.Hearts >= p.Max || u.HeartsUpdatedAt.IsZero() {
		return u, nil
	}
	gain := int(time.Since(u.HeartsUpdatedAt) / p.Every)
	if gain <= 0 {
		return u, nil
	}
	next := u.Hearts + gain
	if next > p.Max {
		next = p.Max
	}
	if err := h.store.SetHearts(ctx, u.ID, next); err != nil {
		return u, err
	}
	u.Hearts = next
	u.HeartsUpdatedAt = time.Now()
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
	if cur == 0 && h.Policy(ctx).LockEmpty && !u.IsLocked {
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
