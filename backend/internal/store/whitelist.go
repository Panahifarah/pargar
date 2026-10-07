package store

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"pargar/backend/internal/models"
)

var (
	ErrWhitelistNotAllowed   = errors.New("phone not on whitelist")
	ErrWhitelistConsumed     = errors.New("whitelist phone already consumed")
	ErrWhitelistNotFound     = errors.New("whitelist entry not found")
	ErrWhitelistNotAvailable = errors.New("whitelist entry not available")
)

const whitelistCols = `id, phone, status, consumed_at, consumed_user_id, created_by, created_at`

func scanWhitelist(row rowScanner) (*models.RegistrationPhoneWhitelist, error) {
	var e models.RegistrationPhoneWhitelist
	var status string
	err := row.Scan(
		&e.ID, &e.Phone, &status, &e.ConsumedAt, &e.ConsumedUserID, &e.CreatedBy, &e.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWhitelistNotFound
	}
	if err != nil {
		return nil, err
	}
	e.Status = models.WhitelistStatus(status)
	return &e, nil
}

// WhitelistImportResult is the outcome of a whitelist import batch.
type WhitelistImportResult struct {
	Inserted             int
	Skipped              int
	Rejected             int
	RejectedPhones       []string
	RemovedBlacklist     int
	BlacklistedConflicts []string
}

// ImportWhitelistPhones inserts available phones; skips duplicates.
// Phones on the blacklist are reported in BlacklistedConflicts unless resolveConflicts
// is true, in which case they are removed from the blacklist then added to the whitelist.
// Phones already belonging to a user are rejected (cannot be on both lists / re-registered).
func (s *Store) ImportWhitelistPhones(ctx context.Context, phones []string, createdBy int64, resolveConflicts bool) (WhitelistImportResult, error) {
	var result WhitelistImportResult
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

		var userExists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1)`, phone).Scan(&userExists); err != nil {
			return WhitelistImportResult{}, err
		}
		if userExists {
			result.Rejected++
			result.RejectedPhones = append(result.RejectedPhones, phone)
			continue
		}

		blocked, err := isPhoneBlacklistedTx(ctx, tx, phone)
		if err != nil {
			return WhitelistImportResult{}, err
		}
		if blocked {
			if !resolveConflicts {
				result.BlacklistedConflicts = append(result.BlacklistedConflicts, phone)
				continue
			}
			tag, err := tx.Exec(ctx, `
				DELETE FROM registration_phone_blacklist WHERE phone = $1`, phone)
			if err != nil {
				return WhitelistImportResult{}, err
			}
			if tag.RowsAffected() > 0 {
				result.RemovedBlacklist++
			}
		}

		tag, err := tx.Exec(ctx, `
			INSERT INTO registration_phone_whitelist (phone, created_by)
			VALUES ($1, $2)
			ON CONFLICT (phone) DO NOTHING`, phone, createdBy)
		if err != nil {
			return WhitelistImportResult{}, err
		}
		if tag.RowsAffected() == 0 {
			result.Skipped++
		} else {
			result.Inserted++
		}
	}
	if err := assertPhoneListsExclusiveTx(ctx, tx); err != nil {
		return WhitelistImportResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WhitelistImportResult{}, err
	}
	return result, nil
}

func (s *Store) ListWhitelistPhones(ctx context.Context, status, query string, limit, offset int) ([]models.RegistrationPhoneWhitelist, int64, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	status = strings.TrimSpace(status)
	query = strings.TrimSpace(query)
	filtered := status == string(models.WhitelistAvailable) || status == string(models.WhitelistConsumed)

	where := `($1 = '' OR phone ILIKE '%'||$1||'%')`
	args := []any{query}
	if filtered {
		args = append(args, status)
		where += ` AND status = $2`
	}

	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM registration_phone_whitelist WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	args = append(args, limit, offset)
	order := `ORDER BY created_at DESC`
	if !filtered {
		order = `ORDER BY CASE status WHEN 'available' THEN 0 ELSE 1 END, created_at DESC`
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+whitelistCols+`
		FROM registration_phone_whitelist
		WHERE `+where+`
		`+order+`
		LIMIT $`+strconv.Itoa(limitIdx)+` OFFSET $`+strconv.Itoa(offsetIdx), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []models.RegistrationPhoneWhitelist
	for rows.Next() {
		e, err := scanWhitelist(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *e)
	}
	return out, total, rows.Err()
}

func (s *Store) GetWhitelistByPhone(ctx context.Context, phone string) (*models.RegistrationPhoneWhitelist, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+whitelistCols+`
		FROM registration_phone_whitelist WHERE phone=$1`, phone)
	return scanWhitelist(row)
}

// DeleteAvailableWhitelistPhone removes an unused whitelist entry.
func (s *Store) DeleteAvailableWhitelistPhone(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM registration_phone_whitelist
		WHERE id = $1 AND status = 'available'`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	var status string
	err = s.pool.QueryRow(ctx, `
		SELECT status FROM registration_phone_whitelist WHERE id=$1`, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWhitelistNotFound
	}
	if err != nil {
		return err
	}
	return ErrWhitelistNotAvailable
}

// consumeWhitelistPhoneTx marks an available phone as consumed for userID.
// require: if true, missing/consumed returns an error; if false, missing/consumed is a no-op.
func consumeWhitelistPhoneTx(ctx context.Context, tx pgx.Tx, phone string, userID int64, require bool) error {
	tag, err := tx.Exec(ctx, `
		UPDATE registration_phone_whitelist
		SET status = 'consumed',
		    consumed_at = now(),
		    consumed_user_id = $2
		WHERE phone = $1 AND status = 'available'`, phone, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if !require {
		return nil
	}
	var status string
	err = tx.QueryRow(ctx, `
		SELECT status FROM registration_phone_whitelist WHERE phone=$1`, phone).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWhitelistNotAllowed
	}
	if err != nil {
		return err
	}
	if status == string(models.WhitelistConsumed) {
		return ErrWhitelistConsumed
	}
	return ErrWhitelistNotAllowed
}
