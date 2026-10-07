package store

import (
	"context"
	"time"
)

// LearningOverview is cohort-level learning analytics for staff.
type LearningOverview struct {
	StudentsActive   int64   `json:"studentsActive"`
	StudentsLocked   int64   `json:"studentsLocked"`
	StudentsTotal    int64   `json:"studentsTotal"`
	LessonsTotal     int64   `json:"lessonsTotal"`
	Completions      int64   `json:"completions"`
	Attempts7d       int64   `json:"attempts7d"`
	Passes7d         int64   `json:"passes7d"`
	PassRate7d       float64 `json:"passRate7d"`
	AvgWatchPct      float64 `json:"avgWatchPct"`
	XPAwarded7d      int64   `json:"xpAwarded7d"`
	StudentsStreaking int64  `json:"studentsStreaking"`
}

func (s *Store) LearningOverview(ctx context.Context) (*LearningOverview, error) {
	o := &LearningOverview{}
	if err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE role='student'),
			COUNT(*) FILTER (WHERE role='student' AND is_active),
			COUNT(*) FILTER (WHERE role='student' AND is_locked)
		FROM users`).Scan(&o.StudentsTotal, &o.StudentsActive, &o.StudentsLocked); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM lessons WHERE is_active`).Scan(&o.LessonsTotal); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM lesson_progress WHERE passed_quiz`).Scan(&o.Completions); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status='passed')
		FROM quiz_attempts
		WHERE created_at >= now() - interval '7 days'`).Scan(&o.Attempts7d, &o.Passes7d); err != nil {
		return nil, err
	}
	if o.Attempts7d > 0 {
		o.PassRate7d = float64(o.Passes7d) / float64(o.Attempts7d) * 100
	}
	_ = s.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(watched_pct), 0)
		FROM lesson_progress
		WHERE watched_pct > 0 AND NOT passed_quiz`).Scan(&o.AvgWatchPct)
	_ = s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM xp_events
		WHERE created_at >= now() - interval '7 days'`).Scan(&o.XPAwarded7d)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM users
		WHERE role='student' AND streak_current > 0 AND is_active`).Scan(&o.StudentsStreaking)
	return o, nil
}

// StudentLearningRow is a list row for the learning dashboard.
type StudentLearningRow struct {
	ID             int64      `json:"id"`
	Name           string     `json:"name"`
	Username       string     `json:"username"`
	Email          string     `json:"email"`
	XP             int        `json:"xp"`
	Hearts         int        `json:"hearts"`
	StreakCurrent  int        `json:"streakCurrent"`
	IsLocked       bool       `json:"isLocked"`
	IsActive       bool       `json:"isActive"`
	LessonsPassed  int64      `json:"lessonsPassed"`
	LessonsTotal   int64      `json:"lessonsTotal"`
	ProgressPct    float64    `json:"progressPct"`
	Attempts7d     int64      `json:"attempts7d"`
	Passes7d       int64      `json:"passes7d"`
	PassRate7d     float64    `json:"passRate7d"`
	LastActivityAt *time.Time `json:"lastActivityAt,omitempty"`
}

func (s *Store) ListStudentLearning(ctx context.Context, q string) ([]StudentLearningRow, error) {
	var lessonsTotal int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM lessons WHERE is_active`).Scan(&lessonsTotal); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.name, u.username, u.email, u.xp, u.hearts, u.streak_current,
			u.is_locked, u.is_active, u.last_activity_date,
			COALESCE(p.passed, 0),
			COALESCE(a.attempts_7d, 0),
			COALESCE(a.passes_7d, 0)
		FROM users u
		LEFT JOIN (
			SELECT user_id, COUNT(*) FILTER (WHERE passed_quiz) AS passed
			FROM lesson_progress GROUP BY user_id
		) p ON p.user_id = u.id
		LEFT JOIN (
			SELECT user_id,
				COUNT(*) AS attempts_7d,
				COUNT(*) FILTER (WHERE status='passed') AS passes_7d
			FROM quiz_attempts
			WHERE created_at >= now() - interval '7 days'
			GROUP BY user_id
		) a ON a.user_id = u.id
		WHERE u.role = 'student'
			AND ($1 = '' OR u.name ILIKE '%'||$1||'%' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%')
		ORDER BY u.xp DESC, u.id ASC
		LIMIT 500`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]StudentLearningRow, 0)
	for rows.Next() {
		var r StudentLearningRow
		r.LessonsTotal = lessonsTotal
		if err := rows.Scan(
			&r.ID, &r.Name, &r.Username, &r.Email, &r.XP, &r.Hearts, &r.StreakCurrent,
			&r.IsLocked, &r.IsActive, &r.LastActivityAt,
			&r.LessonsPassed, &r.Attempts7d, &r.Passes7d,
		); err != nil {
			return nil, err
		}
		if r.LessonsTotal > 0 {
			r.ProgressPct = float64(r.LessonsPassed) / float64(r.LessonsTotal) * 100
		}
		if r.Attempts7d > 0 {
			r.PassRate7d = float64(r.Passes7d) / float64(r.Attempts7d) * 100
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type LessonLearningDetail struct {
	LessonID        int64      `json:"lessonId"`
	ChapterID       int64      `json:"chapterId"`
	ChapterTitle    string     `json:"chapterTitle"`
	Title           string     `json:"title"`
	SortOrder       int        `json:"sortOrder"`
	WatchedPct      float64    `json:"watchedPct"`
	QuizUnlocked    bool       `json:"quizUnlocked"`
	PassedQuiz      bool       `json:"passedQuiz"`
	QuizCompletedAt *time.Time `json:"quizCompletedAt,omitempty"`
	LastAttemptStatus string   `json:"lastAttemptStatus,omitempty"`
	LastAttemptScore  float64  `json:"lastAttemptScore,omitempty"`
}

type AttemptLearningDetail struct {
	ID           int64     `json:"id"`
	LessonID     int64     `json:"lessonId"`
	LessonTitle  string    `json:"lessonTitle"`
	CorrectCount int       `json:"correctCount"`
	Total        int       `json:"total"`
	ScorePct     float64   `json:"scorePct"`
	Status       string    `json:"status"`
	HeartsLost   int       `json:"heartsLost"`
	CreatedAt    time.Time `json:"createdAt"`
}

type XPEventDetail struct {
	ID        int64     `json:"id"`
	Amount    int       `json:"amount"`
	Source    string    `json:"source"`
	RefID     int64     `json:"refId"`
	CreatedAt time.Time `json:"createdAt"`
}

type WatchSessionDetail struct {
	LessonID        int64     `json:"lessonId"`
	LessonTitle     string    `json:"lessonTitle"`
	StartedAt       time.Time `json:"startedAt"`
	LastHeartbeatAt time.Time `json:"lastHeartbeatAt"`
	LastPosition    float64   `json:"lastPosition"`
}

type UserLearningDetail struct {
	User      StudentLearningRow      `json:"user"`
	Lessons   []LessonLearningDetail  `json:"lessons"`
	Attempts  []AttemptLearningDetail `json:"attempts"`
	XPEvents  []XPEventDetail         `json:"xpEvents"`
	Sessions  []WatchSessionDetail    `json:"sessions"`
}

func (s *Store) UserLearningDetail(ctx context.Context, userID int64) (*UserLearningDetail, error) {
	u, err := s.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	list, err := s.ListStudentLearning(ctx, "")
	if err != nil {
		return nil, err
	}
	var row StudentLearningRow
	found := false
	for _, r := range list {
		if r.ID == userID {
			row = r
			found = true
			break
		}
	}
	if !found {
		row = StudentLearningRow{
			ID: u.ID, Name: u.Name, Username: u.Username, Email: u.Email,
			XP: u.XP, Hearts: u.Hearts, StreakCurrent: u.StreakCurrent,
			IsLocked: u.IsLocked, IsActive: u.IsActive, LastActivityAt: u.LastActivityDate,
		}
		_ = s.pool.QueryRow(ctx, `SELECT count(*) FROM lessons WHERE is_active`).Scan(&row.LessonsTotal)
		_ = s.pool.QueryRow(ctx, `SELECT count(*) FROM lesson_progress WHERE user_id=$1 AND passed_quiz`, userID).Scan(&row.LessonsPassed)
		if row.LessonsTotal > 0 {
			row.ProgressPct = float64(row.LessonsPassed) / float64(row.LessonsTotal) * 100
		}
	}

	detail := &UserLearningDetail{User: row, Lessons: []LessonLearningDetail{}, Attempts: []AttemptLearningDetail{}, XPEvents: []XPEventDetail{}, Sessions: []WatchSessionDetail{}}

	lrows, err := s.pool.Query(ctx, `
		SELECT l.id, l.chapter_id, c.title, l.title, l.sort_order,
			COALESCE(p.watched_pct, 0), COALESCE(p.quiz_unlocked, false), COALESCE(p.passed_quiz, false), p.quiz_completed_at,
			COALESCE(la.status, ''), COALESCE(la.score_pct, 0)
		FROM lessons l
		JOIN chapters c ON c.id = l.chapter_id
		LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = $1
		LEFT JOIN LATERAL (
			SELECT status, score_pct FROM quiz_attempts
			WHERE user_id=$1 AND lesson_id=l.id
			ORDER BY created_at DESC LIMIT 1
		) la ON true
		WHERE l.is_active
		ORDER BY c.sort_order, l.sort_order, l.id`, userID)
	if err != nil {
		return nil, err
	}
	defer lrows.Close()
	for lrows.Next() {
		var d LessonLearningDetail
		if err := lrows.Scan(
			&d.LessonID, &d.ChapterID, &d.ChapterTitle, &d.Title, &d.SortOrder,
			&d.WatchedPct, &d.QuizUnlocked, &d.PassedQuiz, &d.QuizCompletedAt,
			&d.LastAttemptStatus, &d.LastAttemptScore,
		); err != nil {
			return nil, err
		}
		detail.Lessons = append(detail.Lessons, d)
	}
	if err := lrows.Err(); err != nil {
		return nil, err
	}

	arows, err := s.pool.Query(ctx, `
		SELECT a.id, a.lesson_id, l.title, a.correct_count, a.total, a.score_pct, a.status, a.hearts_lost, a.created_at
		FROM quiz_attempts a
		JOIN lessons l ON l.id = a.lesson_id
		WHERE a.user_id = $1
		ORDER BY a.created_at DESC
		LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer arows.Close()
	for arows.Next() {
		var a AttemptLearningDetail
		if err := arows.Scan(&a.ID, &a.LessonID, &a.LessonTitle, &a.CorrectCount, &a.Total, &a.ScorePct, &a.Status, &a.HeartsLost, &a.CreatedAt); err != nil {
			return nil, err
		}
		detail.Attempts = append(detail.Attempts, a)
	}
	if err := arows.Err(); err != nil {
		return nil, err
	}

	xrows, err := s.pool.Query(ctx, `
		SELECT id, amount, source, COALESCE(ref_id, 0), created_at
		FROM xp_events WHERE user_id=$1
		ORDER BY created_at DESC LIMIT 40`, userID)
	if err != nil {
		return nil, err
	}
	defer xrows.Close()
	for xrows.Next() {
		var x XPEventDetail
		if err := xrows.Scan(&x.ID, &x.Amount, &x.Source, &x.RefID, &x.CreatedAt); err != nil {
			return nil, err
		}
		detail.XPEvents = append(detail.XPEvents, x)
	}
	if err := xrows.Err(); err != nil {
		return nil, err
	}

	srows, err := s.pool.Query(ctx, `
		SELECT ws.lesson_id, l.title, ws.started_at, ws.last_heartbeat_at, ws.last_position
		FROM watch_sessions ws
		JOIN lessons l ON l.id = ws.lesson_id
		WHERE ws.user_id = $1
		ORDER BY ws.last_heartbeat_at DESC
		LIMIT 20`, userID)
	if err != nil {
		return nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var w WatchSessionDetail
		if err := srows.Scan(&w.LessonID, &w.LessonTitle, &w.StartedAt, &w.LastHeartbeatAt, &w.LastPosition); err != nil {
			return nil, err
		}
		detail.Sessions = append(detail.Sessions, w)
	}
	return detail, srows.Err()
}
