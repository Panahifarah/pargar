package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"pargar/backend/internal/models"
)

func (s *Store) CreateChallenge(ctx context.Context, c *models.Challenge) (int64, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO challenges (title, description, target_xp, starts_at, ends_at, is_active, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
		c.Title, c.Description, c.TargetXP, c.StartsAt, c.EndsAt, c.IsActive, c.CreatedBy,
	).Scan(&c.ID, &c.CreatedAt)
	return c.ID, err
}

func (s *Store) UpdateChallenge(ctx context.Context, id int64, c *models.Challenge) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE challenges SET title=$1, description=$2, target_xp=$3, starts_at=$4, ends_at=$5, is_active=$6
		WHERE id=$7`,
		c.Title, c.Description, c.TargetXP, c.StartsAt, c.EndsAt, c.IsActive, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteChallenge(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM challenges WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListChallengesAdmin(ctx context.Context) ([]models.Challenge, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, description, target_xp, starts_at, ends_at, is_active, created_at
		FROM challenges ORDER BY starts_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanChallenges(rows)
}

// ListActiveChallengesForUser returns challenges currently in window (active + now in range) with progress.
func (s *Store) ListActiveChallengesForUser(ctx context.Context, userID int64) ([]models.Challenge, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.title, c.description, c.target_xp, c.starts_at, c.ends_at, c.is_active, c.created_at,
			COALESCE(p.xp, 0) AS my_xp
		FROM challenges c
		LEFT JOIN challenge_progress p ON p.challenge_id = c.id AND p.user_id = $1
		WHERE c.is_active AND c.starts_at <= now() AND c.ends_at >= now()
		ORDER BY c.ends_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Challenge
	for rows.Next() {
		var c models.Challenge
		if err := rows.Scan(&c.ID, &c.Title, &c.Description, &c.TargetXP, &c.StartsAt, &c.EndsAt, &c.IsActive, &c.CreatedAt, &c.MyXP); err != nil {
			return nil, err
		}
		c.Completed = c.MyXP >= c.TargetXP
		out = append(out, c)
	}
	if out == nil {
		out = []models.Challenge{}
	}
	return out, rows.Err()
}

// AddChallengeProgress adds XP toward all active challenges in the current window.
func (s *Store) AddChallengeProgress(ctx context.Context, userID int64, amount int) error {
	if amount <= 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO challenge_progress (challenge_id, user_id, xp, updated_at)
		SELECT c.id, $1, $2, now()
		FROM challenges c
		WHERE c.is_active AND c.starts_at <= now() AND c.ends_at >= now()
		ON CONFLICT (challenge_id, user_id) DO UPDATE
		SET xp = challenge_progress.xp + EXCLUDED.xp,
		    updated_at = now()`, userID, amount)
	return err
}

func scanChallenges(rows pgx.Rows) ([]models.Challenge, error) {
	var out []models.Challenge
	for rows.Next() {
		var c models.Challenge
		if err := rows.Scan(&c.ID, &c.Title, &c.Description, &c.TargetXP, &c.StartsAt, &c.EndsAt, &c.IsActive, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []models.Challenge{}
	}
	return out, rows.Err()
}

func (s *Store) GetChallenge(ctx context.Context, id int64) (*models.Challenge, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, title, description, target_xp, starts_at, ends_at, is_active, created_at
		FROM challenges WHERE id=$1`, id)
	var c models.Challenge
	err := row.Scan(&c.ID, &c.Title, &c.Description, &c.TargetXP, &c.StartsAt, &c.EndsAt, &c.IsActive, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ChallengeWindowOK is a small helper for tests / validation.
func ChallengeWindowOK(starts, ends time.Time) bool {
	return !starts.IsZero() && !ends.IsZero() && !ends.Before(starts)
}
