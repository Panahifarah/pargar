package store

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"pargar/backend/internal/models"
)

var (
	ErrPhoneBlacklisted  = errors.New("phone is blacklisted")
	ErrBlacklistNotFound = errors.New("blacklist entry not found")
)

const blacklistCols = `id, phone, created_by, created_at`

func scanBlacklist(row rowScanner) (*models.RegistrationPhoneBlacklist, error) {
	var e models.RegistrationPhoneBlacklist
	err := row.Scan(&e.ID, &e.Phone, &e.CreatedBy, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrBlacklistNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// IsPhoneBlacklisted reports whether phone is on the registration blacklist.
func (s *Store) IsPhoneBlacklisted(ctx context.Context, phone string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM registration_phone_blacklist WHERE phone=$1)`, phone).Scan(&exists)
	return exists, err
}

func isPhoneBlacklistedTx(ctx context.Context, tx pgx.Tx, phone string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM registration_phone_blacklist WHERE phone=$1)`, phone).Scan(&exists)
	return exists, err
}

// BlacklistImportResult is the outcome of a blacklist import batch.
type BlacklistImportResult struct {
	Inserted             int
	Skipped              int
	RemovedWhitelist     int
	Rejected             int
	RejectedPhones       []string
	WhitelistedConflicts []string
}

// ImportBlacklistPhones inserts phones onto the blacklist.
// Already-blacklisted phones are skipped.
// Available whitelist entries are reported in WhitelistedConflicts unless resolveConflicts
// is true, in which case they are removed from the whitelist then blacklisted.
// Phones already consumed as users (whitelist consumed or existing user) are rejected.
func (s *Store) ImportBlacklistPhones(ctx context.Context, phones []string, createdBy int64, resolveConflicts bool) (BlacklistImportResult, error) {
	var result BlacklistImportResult
	if len(phones) == 0 {
		return result, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)

	for _, phone := range phones {
		phone = strings.TrimSpace(phone)
		if phone == "" {
			continue
		}

		var wlStatus string
		wlErr := tx.QueryRow(ctx, `
			SELECT status FROM registration_phone_whitelist WHERE phone=$1`, phone).Scan(&wlStatus)
		if wlErr != nil && !errors.Is(wlErr, pgx.ErrNoRows) {
			return BlacklistImportResult{}, wlErr
		}
		onWhitelist := wlErr == nil

		if onWhitelist && wlStatus == string(models.WhitelistConsumed) {
			result.Rejected++
			result.RejectedPhones = append(result.RejectedPhones, phone)
			continue
		}

		var userExists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1)`, phone).Scan(&userExists); err != nil {
			return BlacklistImportResult{}, err
		}
		if userExists {
			result.Rejected++
			result.RejectedPhones = append(result.RejectedPhones, phone)
			continue
		}

		if onWhitelist && wlStatus == string(models.WhitelistAvailable) {
			if !resolveConflicts {
				result.WhitelistedConflicts = append(result.WhitelistedConflicts, phone)
				continue
			}
			tag, err := tx.Exec(ctx, `
				DELETE FROM registration_phone_whitelist
				WHERE phone = $1 AND status = 'available'`, phone)
			if err != nil {
				return BlacklistImportResult{}, err
			}
			if tag.RowsAffected() > 0 {
				result.RemovedWhitelist++
			}
		}

		tag, err := tx.Exec(ctx, `
			INSERT INTO registration_phone_blacklist (phone, created_by)
			VALUES ($1, $2)
			ON CONFLICT (phone) DO NOTHING`, phone, createdBy)
		if err != nil {
			return BlacklistImportResult{}, err
		}
		if tag.RowsAffected() == 0 {
			result.Skipped++
		} else {
			result.Inserted++
		}
	}
	if err := assertPhoneListsExclusiveTx(ctx, tx); err != nil {
		return BlacklistImportResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return BlacklistImportResult{}, err
	}
	return result, nil
}

// assertPhoneListsExclusiveTx fails if any phone appears on both whitelist and blacklist.
func assertPhoneListsExclusiveTx(ctx context.Context, tx pgx.Tx) error {
	var n int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM registration_phone_whitelist w
		INNER JOIN registration_phone_blacklist b ON b.phone = w.phone`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return errors.New("phone cannot be on whitelist and blacklist at the same time")
	}
	return nil
}

func (s *Store) ListBlacklistPhones(ctx context.Context, query string, limit, offset int) ([]models.RegistrationPhoneBlacklist, int64, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	query = strings.TrimSpace(query)
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM registration_phone_blacklist
		WHERE ($1 = '' OR phone ILIKE '%'||$1||'%')`, query).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+blacklistCols+`
		FROM registration_phone_blacklist
		WHERE ($1 = '' OR phone ILIKE '%'||$1||'%')
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`, query, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []models.RegistrationPhoneBlacklist
	for rows.Next() {
		e, err := scanBlacklist(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *e)
	}
	return out, total, rows.Err()
}

// DeleteBlacklistPhone removes a blacklist entry by id.
func (s *Store) DeleteBlacklistPhone(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM registration_phone_blacklist WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrBlacklistNotFound
	}
	return nil
}

const blacklistAttemptCols = `id, phone, path, invite_id, ip, user_agent,
	attempted_username, attempted_email, attempted_at`

func scanBlacklistAttempt(row rowScanner) (*models.RegistrationBlacklistAttempt, error) {
	var e models.RegistrationBlacklistAttempt
	err := row.Scan(
		&e.ID, &e.Phone, &e.Path, &e.InviteID, &e.IP, &e.UserAgent,
		&e.AttemptedUsername, &e.AttemptedEmail, &e.AttemptedAt,
	)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// RecordBlacklistAttempt inserts an audit row when a blacklisted phone tries to register.
func (s *Store) RecordBlacklistAttempt(
	ctx context.Context,
	phone, path string,
	inviteID *int64,
	ip, userAgent, username, email string,
) (*models.RegistrationBlacklistAttempt, error) {
	if path != "public" && path != "invite" {
		path = "public"
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO registration_blacklist_attempts
			(phone, path, invite_id, ip, user_agent, attempted_username, attempted_email)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING `+blacklistAttemptCols,
		phone, path, inviteID, ip, userAgent, username, email,
	)
	return scanBlacklistAttempt(row)
}

// ListBlacklistAttempts returns recent attempts, optionally filtered by q (phone/username/email).
func (s *Store) ListBlacklistAttempts(ctx context.Context, query string, limit, offset int) ([]models.RegistrationBlacklistAttempt, int64, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	query = strings.TrimSpace(query)
	where := `($1 = '' OR phone ILIKE '%'||$1||'%'
		OR COALESCE(attempted_username, '') ILIKE '%'||$1||'%'
		OR COALESCE(attempted_email, '') ILIKE '%'||$1||'%')`
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM registration_blacklist_attempts WHERE `+where, query).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+blacklistAttemptCols+`
		FROM registration_blacklist_attempts
		WHERE `+where+`
		ORDER BY attempted_at DESC
		LIMIT $2 OFFSET $3`, query, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []models.RegistrationBlacklistAttempt
	for rows.Next() {
		e, err := scanBlacklistAttempt(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *e)
	}
	return out, total, rows.Err()
}
