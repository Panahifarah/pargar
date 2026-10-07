package service

import (
	"context"
	"errors"
	"time"

	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

var (
	ErrLocked          = errors.New("حساب محدود شده است")
	ErrLessonLocked    = errors.New("درس قفل است")
	ErrQuizNotUnlocked = errors.New("آزمون هنوز باز نشده است")
	ErrAlreadyPassed   = errors.New("درس قبلاً تکمیل شده است")
)

// Max seconds of watch progress accepted per heartbeat (client interval is 10s).
const maxHeartbeatDelta = 15.0

// wallClockSlack is added to elapsed wall time when capping delta (timer jitter).
const wallClockSlack = 1.5

// WatchService validates heartbeats and computes verified watch progress.
type WatchService struct {
	store *store.Store
}

func NewWatchService(st *store.Store) *WatchService {
	return &WatchService{store: st}
}

// Heartbeat records verified playback progress.
// position = playback position in seconds; delta = seconds actually played since last ping.
func (w *WatchService) Heartbeat(ctx context.Context, userID int64, lesson *models.Lesson, position, delta float64, seq int) (*models.LessonProgress, error) {
	if position < 0 {
		position = 0
	}
	dur := float64(lesson.DurationSeconds)
	if dur <= 0 {
		dur = 1
	}
	// Clamp position within duration
	if position > dur {
		position = dur
	}
	if delta < 0 {
		delta = 0
	}
	if delta > maxHeartbeatDelta {
		delta = maxHeartbeatDelta
	}
	if delta > dur {
		delta = dur
	}

	session, err := w.store.GetOrCreateSession(ctx, userID, lesson.ID)
	if err != nil {
		return nil, err
	}
	// Cap by wall clock so speedup / forged deltas cannot outrun real time.
	elapsed := time.Since(session.LastHeartbeatAt).Seconds()
	if elapsed < 0 {
		elapsed = 0
	}
	wallCap := elapsed + wallClockSlack
	if delta > wallCap {
		delta = wallCap
	}
	inserted, err := w.store.InsertHeartbeat(ctx, session, position, delta, seq)
	if err != nil {
		return nil, err
	}
	if err := w.store.UpdateSessionPos(ctx, session.ID, position); err != nil {
		return nil, err
	}

	pg, err := w.store.GetProgress(ctx, userID, lesson.ID)
	if err != nil {
		pg = &models.LessonProgress{UserID: userID, LessonID: lesson.ID}
	}
	// Only credit progress when the heartbeat row was newly inserted (prevents seq replay).
	if inserted {
		pg.WatchedSeconds += delta
	}
	if pg.WatchedSeconds > dur {
		pg.WatchedSeconds = dur
	}
	pg.WatchedPct = pg.WatchedSeconds / dur * 100
	pg.LastPosition = position

	// mark quiz unlocked once threshold met
	if !pg.QuizUnlocked && pg.WatchedPct >= float64(lesson.CompletionThresholdPct) {
		pg.QuizUnlocked = true
		if err := w.store.SetQuizUnlocked(ctx, userID, lesson.ID); err != nil {
			return nil, err
		}
	}
	if err := w.store.UpsertProgress(ctx, pg); err != nil {
		return nil, err
	}
	return pg, nil
}

func (w *WatchService) ResumePosition(ctx context.Context, userID, lessonID int64) (float64, error) {
	pg, err := w.store.GetProgress(ctx, userID, lessonID)
	if err != nil {
		return 0, nil
	}
	return pg.LastPosition, nil
}
