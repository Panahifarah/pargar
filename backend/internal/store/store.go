package store

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"pargar/backend/internal/models"
)

var ErrNotFound = errors.New("not found")
var ErrPinLimit = errors.New("pin limit")
var ErrUsernameTaken = errors.New("username taken")
var ErrAccountFrozen = errors.New("account frozen")
var ErrAccountClosed = errors.New("account closed")
var ErrAccountNotFrozen = errors.New("account not frozen")

// UsernameCooldownError means the caller already used the username-change allowance.
type UsernameCooldownError struct {
	Until time.Time
}

func (e *UsernameCooldownError) Error() string { return "username cooldown" }

const MaxHearts = 5

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Pool() *pgxpool.Pool { return s.pool }

type Tx struct {
	queries pgx.Tx
}

func (s *Store) Begin(ctx context.Context) (*Tx, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &Tx{queries: tx}, nil
}

func (t *Tx) Commit(ctx context.Context) error { return t.queries.Commit(ctx) }
func (t *Tx) Rollback(ctx context.Context) error {
	return t.queries.Rollback(ctx)
}

// ---- Users ----

func (s *Store) CreateUser(ctx context.Context, name, email, username, passwordHash, phone, securityQuestion, securityAnswerHash string, role models.Role) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO users (name, email, username, password_hash, role, phone, security_question, security_answer_hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+userCols,
		name, email, username, passwordHash, role.String(), phone, securityQuestion, securityAnswerHash)
	u, err := scanUser(row)
	if err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO notification_prefs (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, u.ID); err != nil {
		return nil, err
	}
	return u, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

var _ rowScanner = pgx.Row(nil)

func scanUser(row rowScanner) (*models.User, error) {
	var u models.User
	err := row.Scan(&u.ID, &u.Name, &u.Email, &u.Username, &u.PasswordHash, &u.Role,
		&u.XP, &u.Hearts, &u.HeartsUpdatedAt, &u.StreakCurrent, &u.StreakLongest,
		&u.LastActivityDate, &u.IsLocked, &u.LockedAt, &u.UnlockedBy, &u.IsActive,
		&u.AvatarVariant, &u.AvatarPalette, &u.AvatarPhoto,
		&u.Phone, &u.TelegramID, &u.TelegramUsername, &u.SecurityQuestion, &u.SecurityAnswerHash,
		&u.CreatedAt, &u.UsernameChangeCount, &u.UsernameCooldownUntil,
		&u.FrozenAt, &u.ClosedAt)
	if err != nil {
		return nil, err
	}
	u.HasSecurityAnswer = u.SecurityAnswerHash != ""
	now := time.Now()
	u.ApplyUsernameQuota(now)
	u.ApplyFreezeState(now)
	return &u, nil
}

// humanOnly keeps bot accounts, which share the mentor role, out of people lists.
const humanOnly = `NOT EXISTS (SELECT 1 FROM bot_tokens WHERE bot_user_id = users.id)`

const userCols = `id, name, email, username, password_hash, role, xp, hearts, hearts_updated_at,
	streak_current, streak_longest, last_activity_date, is_locked, locked_at,
	unlocked_by, is_active, avatar_variant, avatar_palette, avatar_photo,
	phone, telegram_id, telegram_username, security_question, security_answer_hash, created_at,
	username_change_count, username_cooldown_until, frozen_at, closed_at`

func (s *Store) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE email=$1`, email)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE lower(username)=$1`, username)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

// GetUserByLogin resolves an email or username identifier.
func (s *Store) GetUserByLogin(ctx context.Context, login string) (*models.User, error) {
	login = strings.TrimSpace(login)
	if strings.Contains(login, "@") {
		return s.GetUserByEmail(ctx, strings.ToLower(login))
	}
	return s.GetUserByUsername(ctx, strings.ToLower(login))
}

func (s *Store) GetUserByID(ctx context.Context, id int64) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id=$1`, id)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) UpdateUserStats(ctx context.Context, userID int64, xp int, streak int, streakLongest int, lastActivity *time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET xp=$1, streak_current=$2, streak_longest=$3, last_activity_date=$4
		WHERE id=$5`, xp, streak, streakLongest, lastActivity, userID)
	return err
}

// UpdateStreakOnly updates streak fields without rewriting XP (avoids clobbering concurrent AddUserXP).
func (s *Store) UpdateStreakOnly(ctx context.Context, userID int64, streak int, streakLongest int, lastActivity *time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET streak_current=$1, streak_longest=$2, last_activity_date=$3
		WHERE id=$4`, streak, streakLongest, lastActivity, userID)
	return err
}

func (s *Store) AddUserXP(ctx context.Context, userID int64, amount int) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `UPDATE users SET xp = xp + $1 WHERE id=$2 RETURNING `+userCols, amount, userID)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) SetHearts(ctx context.Context, userID int64, hearts int) error {
	violation := hearts > MaxHearts
	if hearts < 0 {
		hearts = 0
	}
	if violation {
		hearts = MaxHearts
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE users
		SET hearts=$1, hearts_updated_at=now(), is_locked=is_locked OR $3,
			locked_at=CASE WHEN $3 THEN COALESCE(locked_at, now()) ELSE locked_at END
		WHERE id=$2`, hearts, userID, violation)
	return err
}

func (s *Store) UpdateAvatar(ctx context.Context, userID int64, variant, palette *string, photo *string) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET
			avatar_variant = COALESCE($2::text, avatar_variant),
			avatar_palette = COALESCE($3::text, avatar_palette),
			avatar_photo   = COALESCE($4::text, avatar_photo)
		WHERE id=$1 RETURNING `+userCols, userID, variant, palette, photo)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) LockUser(ctx context.Context, userID int64) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET is_locked=true, locked_at=now() WHERE id=$1 RETURNING `+userCols, userID)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) UnlockUser(ctx context.Context, userID int64, by int64) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET is_locked=false, locked_at=NULL, unlocked_by=$1, hearts=5, hearts_updated_at=now()
		WHERE id=$2 RETURNING `+userCols, by, userID)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

// FreezeUser records the start of the 30-day self-service freeze. It does not touch is_locked.
func (s *Store) FreezeUser(ctx context.Context, id int64) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET frozen_at = now()
		WHERE id=$1 AND frozen_at IS NULL AND closed_at IS NULL
		RETURNING `+userCols, id)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, gerr := s.GetUserByID(ctx, id)
		if gerr != nil {
			return nil, gerr
		}
		if existing.IsClosed {
			return nil, ErrAccountClosed
		}
		return nil, ErrAccountFrozen
	}
	return u, err
}

// UnfreezeUser clears frozen_at only while the 30-day window is still open and the account is not closed.
func (s *Store) UnfreezeUser(ctx context.Context, id int64) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET frozen_at = NULL
		WHERE id=$1
		  AND closed_at IS NULL
		  AND frozen_at IS NOT NULL
		  AND now() < frozen_at + interval '30 days'
		RETURNING `+userCols, id)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, gerr := s.GetUserByID(ctx, id)
		if gerr != nil {
			return nil, gerr
		}
		if existing.IsClosed {
			return nil, ErrAccountClosed
		}
		return nil, ErrAccountNotFrozen
	}
	return u, err
}

// MarkAccountClosed sets closed_at once the freeze window has elapsed. A no-op returns the current user.
func (s *Store) MarkAccountClosed(ctx context.Context, id int64) (*models.User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET closed_at = now()
		WHERE id=$1
		  AND closed_at IS NULL
		  AND frozen_at IS NOT NULL
		  AND now() >= frozen_at + interval '30 days'
		RETURNING `+userCols, id)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.GetUserByID(ctx, id)
	}
	return u, err
}

func (s *Store) ListUsers(ctx context.Context, query string, role string, limit, offset int) ([]models.User, int64, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	where := `($1='' OR name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%' OR username ILIKE '%'||$1||'%') AND ` + humanOnly
	args := []any{query}
	if role != "" {
		args = append(args, role)
		where += ` AND role=$2`
	}
	var total int64
	countQ := `SELECT COUNT(*) FROM users WHERE ` + where
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	args = append(args, limit, offset)
	q := `SELECT ` + userCols + ` FROM users WHERE ` + where +
		` ORDER BY created_at ASC LIMIT $` + strconv.Itoa(limitIdx) + ` OFFSET $` + strconv.Itoa(offsetIdx)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []models.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *u)
	}
	return out, total, rows.Err()
}

// ListActiveByRoles returns active users whose role is in roles, ordered by name.
func (s *Store) ListActiveByRoles(ctx context.Context, roles []string, limit, offset int) ([]models.User, int64, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	if len(roles) == 0 {
		return []models.User{}, 0, nil
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM users WHERE is_active AND role::text = ANY($1::text[]) AND `+humanOnly, roles).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+userCols+` FROM users
		WHERE is_active AND role::text = ANY($1::text[]) AND `+humanOnly+`
		ORDER BY name ASC
		LIMIT $2 OFFSET $3`, roles, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []models.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *u)
	}
	return out, total, rows.Err()
}

func (s *Store) ListMentors(ctx context.Context) ([]models.User, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+userCols+` FROM users WHERE role IN ('mentor','admin') AND is_active AND `+humanOnly+` ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

func (s *Store) UpdateUser(ctx context.Context, id int64, name, email, username, passwordHash, phone, securityQuestion, securityAnswerHash string, role models.Role, hearts, xp int) (*models.User, error) {
	violation := hearts > MaxHearts
	if hearts < 0 {
		hearts = 0
	}
	if violation {
		hearts = MaxHearts
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE users SET
			name = COALESCE(NULLIF($2::text, ''), name),
			email = COALESCE(NULLIF($3::text, ''), email),
			username = COALESCE(NULLIF($4::text, ''), username),
			password_hash = CASE WHEN $5::text = '' THEN password_hash ELSE $5 END,
			role = $6::user_role,
			hearts = $7,
			xp = $8,
			is_locked = is_locked OR $9,
			locked_at = CASE WHEN $9 THEN COALESCE(locked_at, now()) ELSE locked_at END,
			phone = COALESCE($10, phone),
			security_question = CASE WHEN $11::text = '' THEN security_question ELSE $11 END,
			security_answer_hash = CASE WHEN $12::text = '' THEN security_answer_hash ELSE $12 END
		WHERE id=$1 RETURNING `+userCols,
		id, name, email, username, passwordHash, role.String(), hearts, xp, violation, phone, securityQuestion, securityAnswerHash)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

// ChangeUsername sets a new username and consumes one allowance slot.
// The same username is a no-op. The third change in a window starts a cooldown;
// after that cooldown the allowance returns to the limit.
func (s *Store) ChangeUsername(ctx context.Context, id int64, username string, now time.Time) (*models.User, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var current string
	var count int
	var until *time.Time
	err = tx.QueryRow(ctx, `
		SELECT username, username_change_count, username_cooldown_until
		FROM users WHERE id=$1 FOR UPDATE`, id).Scan(&current, &count, &until)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	reset := false
	if until != nil && !now.Before(*until) {
		count = 0
		until = nil
		reset = true
	}

	if strings.EqualFold(current, username) {
		if reset {
			if _, err := tx.Exec(ctx, `
				UPDATE users SET username_change_count=0, username_cooldown_until=NULL WHERE id=$1`, id); err != nil {
				return nil, err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return s.GetUserByID(ctx, id)
	}

	if count >= models.UsernameChangeLimit {
		if until == nil {
			t := now.Add(models.UsernameChangeCooldown)
			until = &t
			if _, err := tx.Exec(ctx, `
				UPDATE users SET username_change_count=$2, username_cooldown_until=$3 WHERE id=$1`,
				id, count, until); err != nil {
				return nil, err
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
		}
		return nil, &UsernameCooldownError{Until: *until}
	}

	var taken int64
	err = tx.QueryRow(ctx, `SELECT id FROM users WHERE lower(username)=lower($1) AND id<>$2`, username, id).Scan(&taken)
	if err == nil {
		return nil, ErrUsernameTaken
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	count++
	var nextUntil *time.Time
	if count >= models.UsernameChangeLimit {
		t := now.Add(models.UsernameChangeCooldown)
		nextUntil = &t
	}
	row := tx.QueryRow(ctx, `
		UPDATE users
		SET username=$2, username_change_count=$3, username_cooldown_until=$4
		WHERE id=$1
		RETURNING `+userCols, id, username, count, nextUntil)
	u, err := scanUser(row)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUsernameTaken
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUsernameTaken
		}
		return nil, err
	}
	return u, nil
}

func (s *Store) GetUserByPhone(ctx context.Context, phone string) (*models.User, error) {
	phone = strings.TrimSpace(phone)
	if phone == "" {
		return nil, ErrNotFound
	}
	row := s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE phone=$1`, phone)
	u, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) SetUserPassword(ctx context.Context, id int64, passwordHash string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE users SET password_hash=$1 WHERE id=$2`, passwordHash, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrRegistrationIPTaken is returned when an IP has already completed public registration.
var ErrRegistrationIPTaken = errors.New("registration ip taken")

func (s *Store) HasRegistrationIP(ctx context.Context, ip string) (bool, error) {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return false, nil
	}
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM registration_ips WHERE ip=$1)`, ip).Scan(&exists)
	return exists, err
}

// RegisterPublicStudent creates a student and optionally records the client IP.
// When requireWhitelist is true, the phone must be an available whitelist entry.
// Empty ip skips one-registration-per-IP enforcement (NAT / shared egress).
func (s *Store) RegisterPublicStudent(
	ctx context.Context,
	name, email, username, passwordHash, phone, securityQuestion, securityAnswerHash, ip string,
	requireWhitelist bool,
) (*models.User, error) {
	ip = strings.TrimSpace(ip)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if blocked, err := isPhoneBlacklistedTx(ctx, tx, phone); err != nil {
		return nil, err
	} else if blocked {
		return nil, ErrPhoneBlacklisted
	}

	if ip != "" {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM registration_ips WHERE ip=$1)`, ip).Scan(&taken); err != nil {
			return nil, err
		}
		if taken {
			return nil, ErrRegistrationIPTaken
		}
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO users (name, email, username, password_hash, role, phone, security_question, security_answer_hash)
		VALUES ($1, $2, $3, $4, 'student', $5, $6, $7)
		RETURNING `+userCols,
		name, email, username, passwordHash, phone, securityQuestion, securityAnswerHash)
	u, err := scanUser(row)
	if err != nil {
		return nil, err
	}
	if err := consumeWhitelistPhoneTx(ctx, tx, phone, u.ID, requireWhitelist); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_prefs (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, u.ID); err != nil {
		return nil, err
	}
	if ip != "" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO registration_ips (ip, user_id) VALUES ($1, $2)`, ip, u.ID); err != nil {
			if isUniqueViolation(err) {
				return nil, ErrRegistrationIPTaken
			}
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return u, nil
}

func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

// IsUniqueViolation reports a Postgres unique_violation (23505).
func IsUniqueViolation(err error) bool {
	return isUniqueViolation(err)
}

func (s *Store) CountActiveLessons(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM lessons WHERE is_active`).Scan(&n)
	return n, err
}

func (s *Store) CountPassedActiveLessons(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM lesson_progress lp
		JOIN lessons l ON l.id = lp.lesson_id
		WHERE lp.user_id=$1 AND lp.passed_quiz AND l.is_active`, userID).Scan(&n)
	return n, err
}

func (s *Store) HasCompletedCurriculum(ctx context.Context, userID int64) (bool, error) {
	active, err := s.CountActiveLessons(ctx)
	if err != nil {
		return false, err
	}
	if active == 0 {
		return false, nil
	}
	passed, err := s.CountPassedActiveLessons(ctx, userID)
	if err != nil {
		return false, err
	}
	return passed >= active, nil
}

func (s *Store) GetCertificateByUser(ctx context.Context, userID int64) (*models.Certificate, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, user_id, public_id, full_name, issued_at, revoked_at
		FROM certificates WHERE user_id=$1`, userID)
	return scanCertificate(row)
}

func (s *Store) GetCertificateByPublicID(ctx context.Context, publicID string) (*models.Certificate, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, user_id, public_id, full_name, issued_at, revoked_at
		FROM certificates WHERE public_id=$1`, publicID)
	return scanCertificate(row)
}

func scanCertificate(row rowScanner) (*models.Certificate, error) {
	var c models.Certificate
	err := row.Scan(&c.ID, &c.UserID, &c.PublicID, &c.FullName, &c.IssuedAt, &c.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) CreateCertificate(ctx context.Context, userID int64, publicID, fullName string) (*models.Certificate, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO certificates (user_id, public_id, full_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE SET
			full_name = EXCLUDED.full_name,
			revoked_at = NULL
		RETURNING id, user_id, public_id, full_name, issued_at, revoked_at`,
		userID, publicID, fullName)
	return scanCertificate(row)
}

const physicalOrderCols = `id, certificate_id, user_id, status, note,
	recipient_name, phone, address, city, postal_code, tracking_code,
	window_ends_at, created_at, updated_at`

func (s *Store) CreatePhysicalOrder(ctx context.Context, certID, userID int64, windowEndsAt time.Time, ship models.CertificatePhysicalOrder) (*models.CertificatePhysicalOrder, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO certificate_physical_orders (
			certificate_id, user_id, window_ends_at,
			recipient_name, phone, address, city, postal_code
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING `+physicalOrderCols,
		certID, userID, windowEndsAt,
		ship.RecipientName, ship.Phone, ship.Address, ship.City, ship.PostalCode)
	return scanPhysicalOrder(row)
}

func (s *Store) GetLatestPhysicalOrder(ctx context.Context, userID int64) (*models.CertificatePhysicalOrder, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+physicalOrderCols+`
		FROM certificate_physical_orders
		WHERE user_id=$1
		ORDER BY created_at DESC LIMIT 1`, userID)
	return scanPhysicalOrder(row)
}

func (s *Store) GetPhysicalOrder(ctx context.Context, id int64) (*models.CertificatePhysicalOrder, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+physicalOrderCols+`
		FROM certificate_physical_orders WHERE id=$1`, id)
	return scanPhysicalOrder(row)
}

func (s *Store) ListPhysicalOrders(ctx context.Context, status string, limit, offset int) ([]models.CertificatePhysicalOrder, int64, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	where := ""
	args := []any{}
	if status != "" {
		where = ` WHERE o.status=$1`
		args = append(args, status)
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM certificate_physical_orders o`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	q := `
		SELECT o.id, o.certificate_id, o.user_id, o.status, o.note,
			o.recipient_name, o.phone, o.address, o.city, o.postal_code, o.tracking_code,
			o.window_ends_at, o.created_at, o.updated_at,
			u.name, c.public_id
		FROM certificate_physical_orders o
		JOIN users u ON u.id = o.user_id
		JOIN certificates c ON c.id = o.certificate_id` + where + ` ORDER BY o.created_at DESC LIMIT $` + strconv.Itoa(len(args)+1) + ` OFFSET $` + strconv.Itoa(len(args)+2)
	args = append(args, limit, offset)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]models.CertificatePhysicalOrder, 0)
	for rows.Next() {
		var o models.CertificatePhysicalOrder
		if err := rows.Scan(&o.ID, &o.CertificateID, &o.UserID, &o.Status, &o.Note,
			&o.RecipientName, &o.Phone, &o.Address, &o.City, &o.PostalCode, &o.TrackingCode,
			&o.WindowEndsAt, &o.CreatedAt, &o.UpdatedAt, &o.UserName, &o.PublicID); err != nil {
			return nil, 0, err
		}
		out = append(out, o)
	}
	return out, total, rows.Err()
}

func (s *Store) UpdatePhysicalOrder(ctx context.Context, id int64, status models.PhysicalOrderStatus, note, tracking string) (*models.CertificatePhysicalOrder, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE certificate_physical_orders
		SET status=$2,
			note=CASE WHEN $3='' THEN note ELSE $3 END,
			tracking_code=CASE WHEN $4='' THEN tracking_code ELSE $4 END,
			updated_at=now()
		WHERE id=$1
		RETURNING `+physicalOrderCols,
		id, string(status), note, tracking)
	return scanPhysicalOrder(row)
}

func scanPhysicalOrder(row rowScanner) (*models.CertificatePhysicalOrder, error) {
	var o models.CertificatePhysicalOrder
	err := row.Scan(
		&o.ID, &o.CertificateID, &o.UserID, &o.Status, &o.Note,
		&o.RecipientName, &o.Phone, &o.Address, &o.City, &o.PostalCode, &o.TrackingCode,
		&o.WindowEndsAt, &o.CreatedAt, &o.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (s *Store) CreateUnlockRequest(ctx context.Context, userID int64, note string) (*models.UnlockRequest, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO unlock_requests (user_id, note) VALUES ($1, $2)
		RETURNING id, user_id, note, created_at, resolved_at`, userID, note)
	var ur models.UnlockRequest
	if err := row.Scan(&ur.ID, &ur.UserID, &ur.Note, &ur.CreatedAt, &ur.ResolvedAt); err != nil {
		return nil, err
	}
	return &ur, nil
}

func (s *Store) LatestOpenUnlockRequest(ctx context.Context, userID int64, within time.Duration) (*models.UnlockRequest, error) {
	since := time.Now().Add(-within)
	row := s.pool.QueryRow(ctx, `
		SELECT id, user_id, note, created_at, resolved_at
		FROM unlock_requests
		WHERE user_id=$1 AND resolved_at IS NULL AND created_at > $2
		ORDER BY created_at DESC LIMIT 1`, userID, since)
	var ur models.UnlockRequest
	err := row.Scan(&ur.ID, &ur.UserID, &ur.Note, &ur.CreatedAt, &ur.ResolvedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ur, nil
}

func (s *Store) ResolveUnlockRequests(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE unlock_requests SET resolved_at=now()
		WHERE user_id=$1 AND resolved_at IS NULL`, userID)
	return err
}

func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.pool.QueryRow(ctx, `SELECT value FROM app_settings WHERE key=$1`, key).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return v, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO app_settings (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, key, value)
	return err
}

func (s *Store) DeleteUser(ctx context.Context, id int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	queries := []string{
		`DELETE FROM watch_heartbeats WHERE user_id=$1 OR session_id IN (SELECT id FROM watch_sessions WHERE user_id=$1)`,
		`DELETE FROM watch_sessions WHERE user_id=$1`,
		`DELETE FROM quiz_attempts WHERE user_id=$1`,
		`DELETE FROM lesson_progress WHERE user_id=$1`,
		`DELETE FROM xp_events WHERE user_id=$1`,
		`DELETE FROM weekly_leaderboard WHERE user_id=$1`,
		`DELETE FROM event_rsvps WHERE user_id=$1`,
		`DELETE FROM chat_reactions WHERE user_id=$1`,
		`DELETE FROM chat_messages WHERE user_id=$1 OR mentor_id=$1`,
		`DELETE FROM notifications WHERE user_id=$1`,
		`DELETE FROM notification_prefs WHERE user_id=$1`,
		`DELETE FROM refresh_tokens WHERE user_id=$1`,
		`DELETE FROM reminders_sent WHERE user_id=$1`,
		`UPDATE users SET unlocked_by=NULL WHERE unlocked_by=$1`,
		`UPDATE events SET created_by=NULL WHERE created_by=$1`,
		`DELETE FROM users WHERE id=$1`,
	}
	for _, q := range queries {
		if _, err := tx.Exec(ctx, q, id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ---- Chapters / Lessons / Questions ----

func (s *Store) CreateChapter(ctx context.Context, c *models.Chapter) (int64, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO chapters (title, description, icon, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
		c.Title, c.Description, c.Icon, c.SortOrder).Scan(&c.ID)
	return c.ID, err
}

func (s *Store) UpdateChapter(ctx context.Context, id int64, c *models.Chapter) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chapters SET title=$1, description=$2, icon=$3, sort_order=$4 WHERE id=$5`,
		c.Title, c.Description, c.Icon, c.SortOrder, id)
	return err
}

func (s *Store) DeleteChapter(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM chapters WHERE id=$1`, id)
	return err
}

func (s *Store) ListChapters(ctx context.Context) ([]models.Chapter, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, title, description, icon, sort_order FROM chapters ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Chapter
	for rows.Next() {
		var c models.Chapter
		if err := rows.Scan(&c.ID, &c.Title, &c.Description, &c.Icon, &c.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) CreateLesson(ctx context.Context, l *models.Lesson) (int64, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO lessons (chapter_id, title, description, video_key, duration_seconds,
			completion_threshold_pct, requires_lesson_id, x, y, sort_order, xp_reward, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
		l.ChapterID, l.Title, l.Description, l.VideoKey, l.DurationSeconds,
		l.CompletionThresholdPct, l.RequiresLessonID, l.X, l.Y, l.SortOrder, l.XPReward, l.IsActive).Scan(&l.ID)
	return l.ID, err
}

func (s *Store) UpdateLesson(ctx context.Context, id int64, l *models.Lesson) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE lessons SET chapter_id=$1, title=$2, description=$3, video_key=$4, duration_seconds=$5,
			completion_threshold_pct=$6, requires_lesson_id=$7, x=$8, y=$9, sort_order=$10, xp_reward=$11, is_active=$12
		WHERE id=$13`,
		l.ChapterID, l.Title, l.Description, l.VideoKey, l.DurationSeconds,
		l.CompletionThresholdPct, l.RequiresLessonID, l.X, l.Y, l.SortOrder, l.XPReward, l.IsActive, id)
	return err
}

func (s *Store) DeleteLesson(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM lessons WHERE id=$1`, id)
	return err
}

func (s *Store) GetLesson(ctx context.Context, id int64) (*models.Lesson, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, chapter_id, title, description, video_key, duration_seconds,
			completion_threshold_pct, requires_lesson_id, x, y, sort_order, xp_reward, is_active
		FROM lessons WHERE id=$1`, id)
	var l models.Lesson
	err := row.Scan(&l.ID, &l.ChapterID, &l.Title, &l.Description, &l.VideoKey, &l.DurationSeconds,
		&l.CompletionThresholdPct, &l.RequiresLessonID, &l.X, &l.Y, &l.SortOrder, &l.XPReward, &l.IsActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &l, err
}

func (s *Store) ListLessons(ctx context.Context, includeInactive bool) ([]models.Lesson, error) {
	q := `SELECT id, chapter_id, title, description, video_key, duration_seconds,
		completion_threshold_pct, requires_lesson_id, x, y, sort_order, xp_reward, is_active FROM lessons`
	if !includeInactive {
		q += ` WHERE is_active`
	}
	q += ` ORDER BY chapter_id, sort_order, id`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Lesson
	for rows.Next() {
		var l models.Lesson
		if err := rows.Scan(&l.ID, &l.ChapterID, &l.Title, &l.Description, &l.VideoKey, &l.DurationSeconds,
			&l.CompletionThresholdPct, &l.RequiresLessonID, &l.X, &l.Y, &l.SortOrder, &l.XPReward, &l.IsActive); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) CreateQuestion(ctx context.Context, q *models.MCQQuestion) (int64, error) {
	opts, _ := json.Marshal(q.Options)
	err := s.pool.QueryRow(ctx, `
		INSERT INTO mcq_questions (lesson_id, position, question, options, answer_index, explanation)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		q.LessonID, q.Position, q.Question, opts, q.AnswerIndex, q.Explanation).Scan(&q.ID)
	return q.ID, err
}

func (s *Store) UpdateQuestion(ctx context.Context, id int64, q *models.MCQQuestion) error {
	opts, _ := json.Marshal(q.Options)
	_, err := s.pool.Exec(ctx, `
		UPDATE mcq_questions SET position=$1, question=$2, options=$3, answer_index=$4, explanation=$5 WHERE id=$6`,
		q.Position, q.Question, opts, q.AnswerIndex, q.Explanation, id)
	return err
}

func (s *Store) DeleteQuestion(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM mcq_questions WHERE id=$1`, id)
	return err
}

func (s *Store) ListQuestions(ctx context.Context, lessonID int64, withAnswers bool) ([]models.MCQQuestion, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, lesson_id, position, question, options, answer_index, explanation
		FROM mcq_questions WHERE lesson_id=$1 ORDER BY position, id`, lessonID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.MCQQuestion
	for rows.Next() {
		var q models.MCQQuestion
		var opts []byte
		if err := rows.Scan(&q.ID, &q.LessonID, &q.Position, &q.Question, &opts, &q.AnswerIndex, &q.Explanation); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(opts, &q.Options)
		if !withAnswers {
			q.AnswerIndex = -1
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// ---- Watch sessions / heartbeats / progress ----

func (s *Store) GetOrCreateSession(ctx context.Context, userID, lessonID int64) (*models.WatchSession, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO watch_sessions (user_id, lesson_id) VALUES ($1,$2)
		ON CONFLICT (user_id, lesson_id) DO UPDATE SET user_id=EXCLUDED.user_id
		RETURNING id, user_id, lesson_id, started_at, last_heartbeat_at, last_position`,
		userID, lessonID)
	var ws models.WatchSession
	err := row.Scan(&ws.ID, &ws.UserID, &ws.LessonID, &ws.StartedAt, &ws.LastHeartbeatAt, &ws.LastPosition)
	return &ws, err
}

func (s *Store) InsertHeartbeat(ctx context.Context, hb *models.WatchSession, position, delta float64, seq int) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO watch_heartbeats (user_id, lesson_id, session_id, position, delta, seq)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, lesson_id, seq) DO NOTHING`,
		hb.UserID, hb.LessonID, hb.ID, position, delta, seq)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) UpdateSessionPos(ctx context.Context, sessionID int64, position float64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE watch_sessions SET last_position=$1, last_heartbeat_at=now() WHERE id=$2`, position, sessionID)
	return err
}

// MaxHeartbeatSeq returns the highest heartbeat seq for a user/lesson (0 if none).
func (s *Store) MaxHeartbeatSeq(ctx context.Context, userID, lessonID int64) (int, error) {
	var seq int
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(seq), 0) FROM watch_heartbeats
		WHERE user_id=$1 AND lesson_id=$2`, userID, lessonID).Scan(&seq)
	return seq, err
}

func (s *Store) GetProgress(ctx context.Context, userID, lessonID int64) (*models.LessonProgress, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT user_id, lesson_id, watched_seconds, watched_pct, last_position,
			quiz_unlocked, passed_quiz, quiz_completed_at
		FROM lesson_progress WHERE user_id=$1 AND lesson_id=$2`, userID, lessonID)
	var p models.LessonProgress
	err := row.Scan(&p.UserID, &p.LessonID, &p.WatchedSeconds, &p.WatchedPct, &p.LastPosition,
		&p.QuizUnlocked, &p.PassedQuiz, &p.QuizCompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &p, err
}

func (s *Store) UpsertProgress(ctx context.Context, p *models.LessonProgress) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO lesson_progress (user_id, lesson_id, watched_seconds, watched_pct, last_position)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, lesson_id) DO UPDATE SET
			watched_seconds = GREATEST(lesson_progress.watched_seconds, EXCLUDED.watched_seconds),
			watched_pct     = GREATEST(lesson_progress.watched_pct, EXCLUDED.watched_pct),
			last_position   = CASE
				WHEN EXCLUDED.watched_seconds >= lesson_progress.watched_seconds THEN EXCLUDED.last_position
				ELSE lesson_progress.last_position
			END`,
		p.UserID, p.LessonID, p.WatchedSeconds, p.WatchedPct, p.LastPosition)
	return err
}

func (s *Store) SetQuizUnlocked(ctx context.Context, userID, lessonID int64) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO lesson_progress (user_id, lesson_id, quiz_unlocked)
		VALUES ($1,$2,true)
		ON CONFLICT (user_id, lesson_id) DO UPDATE SET quiz_unlocked=true`,
		userID, lessonID)
	return err
}

func (s *Store) MarkQuizPassed(ctx context.Context, userID, lessonID int64) error {
	_, err := s.ClaimFirstQuizPass(ctx, userID, lessonID)
	return err
}

// ClaimFirstQuizPass marks the lesson passed only if it was not already passed.
// Returns true when this call is the first successful pass (XP should be awarded).
func (s *Store) ClaimFirstQuizPass(ctx context.Context, userID, lessonID int64) (bool, error) {
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO lesson_progress (user_id, lesson_id)
		VALUES ($1,$2) ON CONFLICT (user_id, lesson_id) DO NOTHING`, userID, lessonID)
	tag, err := s.pool.Exec(ctx, `
		UPDATE lesson_progress
		SET passed_quiz=true,
			quiz_unlocked=true,
			quiz_completed_at=COALESCE(quiz_completed_at, now())
		WHERE user_id=$1 AND lesson_id=$2 AND NOT passed_quiz`, userID, lessonID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *Store) ProgressMap(ctx context.Context, userID int64) (map[int64]*models.LessonProgress, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT user_id, lesson_id, watched_seconds, watched_pct, last_position,
			quiz_unlocked, passed_quiz, quiz_completed_at
		FROM lesson_progress WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]*models.LessonProgress{}
	for rows.Next() {
		var p models.LessonProgress
		if err := rows.Scan(&p.UserID, &p.LessonID, &p.WatchedSeconds, &p.WatchedPct, &p.LastPosition,
			&p.QuizUnlocked, &p.PassedQuiz, &p.QuizCompletedAt); err != nil {
			return nil, err
		}
		out[p.LessonID] = &p
	}
	return out, rows.Err()
}

// ---- Quiz attempts ----

func (s *Store) CreateAttempt(ctx context.Context, userID, lessonID int64, answers []int) (*models.QuizAttempt, error) {
	b, _ := json.Marshal(answers)
	row := s.pool.QueryRow(ctx, `
		INSERT INTO quiz_attempts (user_id, lesson_id, answers) VALUES ($1,$2,$3)
		RETURNING id, user_id, lesson_id, answers, correct_count, total, score_pct, status, hearts_lost, passed_at, created_at`,
		userID, lessonID, b)
	var a models.QuizAttempt
	var raw []byte
	if err := row.Scan(&a.ID, &a.UserID, &a.LessonID, &raw, &a.CorrectCount, &a.Total, &a.ScorePct,
		&a.Status, &a.HeartsLost, &a.PassedAt, &a.CreatedAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal(raw, &a.Answers)
	return &a, nil
}

func (s *Store) FinalizeAttempt(ctx context.Context, attemptID int64, correct, total int, scorePct float64, status string, heartsLost int) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE quiz_attempts SET correct_count=$1, total=$2, score_pct=$3, status=($4)::quiz_status, hearts_lost=$5,
			passed_at=CASE WHEN $4='passed' THEN now() ELSE passed_at END
		WHERE id=$6`, correct, total, scorePct, status, heartsLost, attemptID)
	return err
}

func (s *Store) LastAttempt(ctx context.Context, userID, lessonID int64) (*models.QuizAttempt, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, user_id, lesson_id, answers, correct_count, total, score_pct, status, hearts_lost, passed_at, created_at
		FROM quiz_attempts WHERE user_id=$1 AND lesson_id=$2 ORDER BY id DESC LIMIT 1`, userID, lessonID)
	var a models.QuizAttempt
	var raw []byte
	if err := row.Scan(&a.ID, &a.UserID, &a.LessonID, &raw, &a.CorrectCount, &a.Total, &a.ScorePct,
		&a.Status, &a.HeartsLost, &a.PassedAt, &a.CreatedAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal(raw, &a.Answers)
	return &a, nil
}

// ---- XP / streaks / leaderboard ----

func (s *Store) AddXPEvent(ctx context.Context, tx *Tx, userID int64, amount int, source string, refID int64) error {
	_, err := tx.queries.Exec(ctx, `INSERT INTO xp_events (user_id, amount, source, ref_id) VALUES ($1,$2,$3,$4)`,
		userID, amount, source, refID)
	return err
}

func (s *Store) UpdateLeaderboardRow(ctx context.Context, week string, userID int64, amount int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO weekly_leaderboard (week, user_id, xp) VALUES ($1,$2,$3)
		ON CONFLICT (week, user_id) DO UPDATE SET xp = weekly_leaderboard.xp + EXCLUDED.xp`,
		week, userID, amount)
	return err
}

// ---- Events / RSVPs ----

func (s *Store) CreateEvent(ctx context.Context, e *models.Event) (int64, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO events (title, description, event_type, external_url, starts_at, ends_at, is_active, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		e.Title, e.Description, e.EventType, e.ExternalURL, e.StartsAt, e.EndsAt, e.IsActive, e.CreatedBy).Scan(&e.ID)
	return e.ID, err
}

func (s *Store) UpdateEvent(ctx context.Context, id int64, e *models.Event) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE events SET title=$1, description=$2, event_type=$3, external_url=$4, starts_at=$5, ends_at=$6, is_active=$7
		WHERE id=$8`, e.Title, e.Description, e.EventType, e.ExternalURL, e.StartsAt, e.EndsAt, e.IsActive, id)
	return err
}

func (s *Store) DeleteEvent(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM events WHERE id=$1`, id)
	return err
}

func (s *Store) GetEvent(ctx context.Context, id int64) (*models.Event, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, title, description, event_type, external_url, starts_at, ends_at, is_active, created_at
		FROM events WHERE id=$1`, id)
	var e models.Event
	err := row.Scan(&e.ID, &e.Title, &e.Description, &e.EventType, &e.ExternalURL, &e.StartsAt, &e.EndsAt, &e.IsActive, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &e, err
}

func (s *Store) ListUpcomingEvents(ctx context.Context, userID int64) ([]models.Event, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.title, e.description, e.event_type, e.external_url, e.starts_at, e.ends_at, e.is_active, e.created_at,
			CASE WHEN EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=$1) THEN true ELSE false END AS rsvped
		FROM events e WHERE e.is_active AND e.ends_at > now() ORDER BY e.starts_at ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.ID, &e.Title, &e.Description, &e.EventType, &e.ExternalURL, &e.StartsAt, &e.EndsAt, &e.IsActive, &e.CreatedAt, &e.Rsvped); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) Rsvp(ctx context.Context, eventID, userID int64) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO event_rsvps (event_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, eventID, userID)
	return err
}

func (s *Store) Unrsvp(ctx context.Context, eventID, userID int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2`, eventID, userID)
	return err
}

func (s *Store) EventRsvpUsers(ctx context.Context, eventID int64) ([]models.User, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+userCols+` FROM users WHERE id IN (SELECT user_id FROM event_rsvps WHERE event_id=$1)`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

// ---- Chat ----

func packChatAttachments(atts []models.Attachment) (typ, url, name *string, size *int64, raw []byte) {
	if len(atts) == 0 {
		return nil, nil, nil, nil, nil
	}
	first := atts[0]
	typ = new(string)
	*typ = first.Type
	url = new(string)
	*url = first.URL
	name = new(string)
	*name = first.Name
	sz := first.Size
	size = &sz
	if len(atts) > 1 {
		if b, err := json.Marshal(atts); err == nil {
			raw = b
		}
	}
	return
}

func (s *Store) AddChatMessage(ctx context.Context, userID, mentorID int64, senderRole models.Role, body string, replyTo *int64, atts []models.Attachment) (*models.ChatMessage, error) {
	attType, attURL, attName, attSize, raw := packChatAttachments(atts)
	var rawArg any
	if len(raw) > 0 {
		rawArg = string(raw)
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO chat_messages (user_id, mentor_id, sender_role, body, reply_to, attachment_type, attachment_url, attachment_name, attachment_size, attachments)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
		RETURNING id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments`,
		userID, mentorID, senderRole.String(), body, replyTo, attType, attURL, attName, attSize, rawArg)
	return scanMessage(row)
}

// ImportChatMessage inserts a historical message (backup restore), preserving created_at / pin.
func (s *Store) ImportChatMessage(ctx context.Context, userID, mentorID int64, senderRole models.Role, body string, atts []models.Attachment, createdAt time.Time, pinned bool) (*models.ChatMessage, error) {
	attType, attURL, attName, attSize, raw := packChatAttachments(atts)
	var rawArg any
	if len(raw) > 0 {
		rawArg = string(raw)
	}
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	var pinnedAt *time.Time
	if pinned {
		t := createdAt
		pinnedAt = &t
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO chat_messages (user_id, mentor_id, sender_role, body, attachment_type, attachment_url, attachment_name, attachment_size, attachments, created_at, pinned_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
		RETURNING id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments`,
		userID, mentorID, senderRole.String(), body, attType, attURL, attName, attSize, rawArg, createdAt, pinnedAt)
	return scanMessage(row)
}

// ListChatPartnerIDs returns distinct partner user ids for conversations involving me.
func (s *Store) ListChatPartnerIDs(ctx context.Context, meID int64) ([]int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT partner FROM (
			SELECT user_id AS partner FROM chat_messages WHERE mentor_id=$1
			UNION
			SELECT mentor_id FROM chat_messages WHERE user_id=$1
		) p
		WHERE partner <> $1
		ORDER BY partner`, meID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// DeleteChatMessage removes one of my own messages in this conversation.
func (s *Store) DeleteChatMessage(ctx context.Context, meID, partnerID, msgID int64, meRole models.Role) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM chat_messages
		WHERE id=$1
		  AND ((user_id=$2 AND mentor_id=$3) OR (user_id=$3 AND mentor_id=$2))
		  AND sender_role=$4
		  AND (user_id=$2 OR mentor_id=$2)`, msgID, meID, partnerID, meRole.String())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ReplaceChatAttachment swaps the photo, video, or voice on one of my messages and marks it edited.
// The new type must match the current attachment.
func (s *Store) ReplaceChatAttachment(ctx context.Context, meID, partnerID, msgID int64, meRole models.Role, body, attType, attURL, attName string, attSize int64) (*models.ChatMessage, error) {
	elem, err := json.Marshal(models.Attachment{Type: attType, URL: attURL, Name: attName, Size: attSize})
	if err != nil {
		return nil, err
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE chat_messages
		SET body=$1, edited_at=now(),
		    attachment_type=$2, attachment_url=$3, attachment_name=$4, attachment_size=$5,
		    attachments = CASE
		        WHEN attachments IS NULL THEN attachments
		        WHEN jsonb_typeof(attachments) <> 'array' THEN attachments
		        WHEN jsonb_array_length(attachments) = 0 THEN attachments
		        ELSE jsonb_set(attachments, '{0}', $6::jsonb, false)
		    END
		WHERE id=$7
		  AND ((user_id=$8 AND mentor_id=$9) OR (user_id=$9 AND mentor_id=$8))
		  AND sender_role=$10
		  AND (user_id=$8 OR mentor_id=$8)
		  AND attachment_type=$2
		RETURNING id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments`,
		body, attType, attURL, attName, attSize, string(elem), msgID, meID, partnerID, meRole.String())
	m, err := scanMessage(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// EditChatMessage replaces the body of one of my own messages in this conversation.
func (s *Store) EditChatMessage(ctx context.Context, meID, partnerID, msgID int64, meRole models.Role, body string) (*models.ChatMessage, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE chat_messages
		SET body=$1, edited_at=now()
		WHERE id=$2
		  AND ((user_id=$3 AND mentor_id=$4) OR (user_id=$4 AND mentor_id=$3))
		  AND sender_role=$5
		  AND (user_id=$3 OR mentor_id=$3)
		  AND ($1 <> '' OR attachment_url IS NOT NULL)
		RETURNING id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments`,
		body, msgID, meID, partnerID, meRole.String())
	m, err := scanMessage(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// GetOwnChatMessage loads one of my messages in this conversation, including its attachments.
func (s *Store) GetOwnChatMessage(ctx context.Context, meID, partnerID, msgID int64, meRole models.Role) (*models.ChatMessage, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments
		FROM chat_messages
		WHERE id=$1
		  AND ((user_id=$2 AND mentor_id=$3) OR (user_id=$3 AND mentor_id=$2))
		  AND sender_role=$4
		  AND (user_id=$2 OR mentor_id=$2)`,
		msgID, meID, partnerID, meRole.String())
	m, err := scanMessage(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// SaveEditedChatMessage writes the caption and the full attachment set for one of my messages.
// Callers pass the attachments that should remain; an empty list is stored as no attachment.
func (s *Store) SaveEditedChatMessage(ctx context.Context, meID, partnerID, msgID int64, meRole models.Role, body string, atts []models.Attachment) (*models.ChatMessage, error) {
	attType, attURL, attName, attSize, raw := packChatAttachments(atts)
	var rawArg any
	if len(raw) > 0 {
		rawArg = string(raw)
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE chat_messages
		SET body=$1, edited_at=now(),
		    attachment_type=$2, attachment_url=$3, attachment_name=$4, attachment_size=$5,
		    attachments=$6::jsonb
		WHERE id=$7
		  AND ((user_id=$8 AND mentor_id=$9) OR (user_id=$9 AND mentor_id=$8))
		  AND sender_role=$10
		  AND (user_id=$8 OR mentor_id=$8)
		RETURNING id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments`,
		body, attType, attURL, attName, attSize, rawArg, msgID, meID, partnerID, meRole.String())
	m, err := scanMessage(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

const maxPinnedMessages = 3

// TogglePinChatMessage pins or unpins a message. If already at the pin limit,
// the oldest pin is replaced so a new message (including emoji-only) can be pinned.
func (s *Store) TogglePinChatMessage(ctx context.Context, meID, partnerID, msgID int64) (*models.ChatMessage, error) {
	ok, err := s.MessageInConversation(ctx, msgID, meID, partnerID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	row := s.pool.QueryRow(ctx, `
		SELECT pinned_at FROM chat_messages WHERE id=$1`, msgID)
	var pinnedAt *time.Time
	if err := row.Scan(&pinnedAt); err != nil {
		return nil, err
	}
	if pinnedAt != nil {
		out := s.pool.QueryRow(ctx, `
			UPDATE chat_messages SET pinned_at=NULL WHERE id=$1
			RETURNING id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
				attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments`, msgID)
		return scanMessage(out)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM chat_messages
		WHERE pinned_at IS NOT NULL
		  AND ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))`,
		meID, partnerID).Scan(&n); err != nil {
		return nil, err
	}
	if n >= maxPinnedMessages {
		// Evict oldest pin in this conversation, then pin the new message.
		if _, err := s.pool.Exec(ctx, `
			UPDATE chat_messages SET pinned_at=NULL
			WHERE id = (
				SELECT id FROM chat_messages
				WHERE pinned_at IS NOT NULL
				  AND ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))
				ORDER BY pinned_at ASC
				LIMIT 1
			)`, meID, partnerID); err != nil {
			return nil, err
		}
	}
	out := s.pool.QueryRow(ctx, `
		UPDATE chat_messages SET pinned_at=now() WHERE id=$1
		RETURNING id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments`, msgID)
	return scanMessage(out)
}

// ListPinnedChatMessages returns pinned messages for a conversation (newest pin first).
func (s *Store) ListPinnedChatMessages(ctx context.Context, userID, mentorID int64) ([]models.ChatMessage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments
		FROM chat_messages
		WHERE pinned_at IS NOT NULL
		  AND ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))
		ORDER BY pinned_at DESC
		LIMIT $3`, userID, mentorID, maxPinnedMessages)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ChatMessage
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// ListChatMessages returns the most recent `limit` messages strictly older than
// `before` (id cursor, 0 = no cutoff), ordered oldest-first.
func (s *Store) ListChatMessages(ctx context.Context, userID, mentorID, before, limit int64) ([]models.ChatMessage, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments
		FROM chat_messages
		WHERE ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))
		  AND ($3 = 0 OR id < $3)
		ORDER BY id DESC
		LIMIT $4`, userID, mentorID, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ChatMessage
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// ChatMessageInPair reports whether msgID belongs to the conversation between the two users.
func (s *Store) ChatMessageInPair(ctx context.Context, userID, partnerID, msgID int64) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM chat_messages
			WHERE id=$3 AND ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))
		)`, userID, partnerID, msgID).Scan(&ok)
	return ok, err
}

// ListChatMessagesAround returns a window of messages centered on aroundID (oldest-first).
func (s *Store) ListChatMessagesAround(ctx context.Context, userID, partnerID, aroundID, limit int64) (msgs []models.ChatMessage, hasMoreBefore, hasMoreAfter bool, err error) {
	if limit < 4 {
		limit = 60
	}
	beforeLimit := limit/2 + 1 // include target
	afterLimit := limit / 2

	older, err := s.pool.Query(ctx, `
		SELECT id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments
		FROM chat_messages
		WHERE ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))
		  AND id <= $3
		ORDER BY id DESC
		LIMIT $4`, userID, partnerID, aroundID, beforeLimit+1)
	if err != nil {
		return nil, false, false, err
	}
	var before []models.ChatMessage
	for older.Next() {
		m, scanErr := scanMessage(older)
		if scanErr != nil {
			older.Close()
			return nil, false, false, scanErr
		}
		before = append(before, *m)
	}
	older.Close()
	if err := older.Err(); err != nil {
		return nil, false, false, err
	}
	if int64(len(before)) > beforeLimit {
		hasMoreBefore = true
		before = before[:beforeLimit]
	}
	for i, j := 0, len(before)-1; i < j; i, j = i+1, j-1 {
		before[i], before[j] = before[j], before[i]
	}

	newer, err := s.pool.Query(ctx, `
		SELECT id, user_id, mentor_id, sender_role, body, read_at, created_at, reply_to,
			attachment_type, attachment_url, attachment_name, attachment_size, pinned_at, edited_at, buttons, attachments
		FROM chat_messages
		WHERE ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))
		  AND id > $3
		ORDER BY id ASC
		LIMIT $4`, userID, partnerID, aroundID, afterLimit+1)
	if err != nil {
		return nil, false, false, err
	}
	var after []models.ChatMessage
	for newer.Next() {
		m, scanErr := scanMessage(newer)
		if scanErr != nil {
			newer.Close()
			return nil, false, false, scanErr
		}
		after = append(after, *m)
	}
	newer.Close()
	if err := newer.Err(); err != nil {
		return nil, false, false, err
	}
	if int64(len(after)) > afterLimit {
		hasMoreAfter = true
		after = after[:afterLimit]
	}

	out := make([]models.ChatMessage, 0, len(before)+len(after))
	out = append(out, before...)
	out = append(out, after...)
	return out, hasMoreBefore, hasMoreAfter, nil
}

type messageScanner interface {
	Scan(dest ...any) error
}

func scanMessage(row messageScanner) (*models.ChatMessage, error) {
	var m models.ChatMessage
	var attType, attURL, attName *string
	var attSize *int64
	var buttons []byte
	var rawAtts []byte
	if err := row.Scan(
		&m.ID, &m.UserID, &m.MentorID, &m.SenderRole, &m.Body, &m.ReadAt, &m.CreatedAt, &m.ReplyTo,
		&attType, &attURL, &attName, &attSize, &m.PinnedAt, &m.EditedAt, &buttons, &rawAtts,
	); err != nil {
		return nil, err
	}
	if len(buttons) > 0 && string(buttons) != "[]" && string(buttons) != "null" {
		m.Buttons = buttons
	}
	m.Pinned = m.PinnedAt != nil
	if len(rawAtts) > 0 && string(rawAtts) != "null" && string(rawAtts) != "[]" {
		var list []models.Attachment
		if err := json.Unmarshal(rawAtts, &list); err == nil && len(list) > 0 {
			m.Attachments = list
			first := list[0]
			m.Attachment = &first
		}
	}
	if m.Attachment == nil && attURL != nil && *attURL != "" {
		m.Attachment = &models.Attachment{
			Type: derefStr(attType), URL: *attURL, Name: derefStr(attName), Size: derefInt(attSize),
		}
	}
	return &m, nil
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func derefInt(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// MarkChatRead stamps messages the other person sent. Opening the thread must not
// mark my own messages as seen.
func (s *Store) MarkChatRead(ctx context.Context, meID, partnerID int64, meRole models.Role) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE chat_messages
		SET read_at=now()
		WHERE read_at IS NULL
		  AND sender_role <> $3
		  AND ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))`,
		meID, partnerID, meRole.String())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// MessageInConversation reports whether a message belongs to a given pair.
func (s *Store) MessageInConversation(ctx context.Context, msgID, meID, partnerID int64) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, `
		SELECT 1 FROM chat_messages
		WHERE id=$1 AND ((user_id=$2 AND mentor_id=$3) OR (user_id=$3 AND mentor_id=$2))`,
		msgID, meID, partnerID).Scan(&one)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

// ReactToChatMessage toggles a reaction on a message: same emoji removes it,
// a different emoji replaces it, a new one is inserted. Returns the resulting
// emoji ("" when removed) and the full updated set.
func (s *Store) ReactToChatMessage(ctx context.Context, msgID, userID int64, emoji string) (string, []models.ChatReaction, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existing string
	err = tx.QueryRow(ctx, `SELECT emoji FROM chat_reactions WHERE message_id=$1 AND user_id=$2`, msgID, userID).Scan(&existing)
	switch {
	case err == nil && existing == emoji:
		if _, err := tx.Exec(ctx, `DELETE FROM chat_reactions WHERE message_id=$1 AND user_id=$2`, msgID, userID); err != nil {
			return "", nil, err
		}
		emoji = ""
	case err == nil:
		if _, err := tx.Exec(ctx, `UPDATE chat_reactions SET emoji=$3, created_at=now() WHERE message_id=$1 AND user_id=$2`, msgID, userID, emoji); err != nil {
			return "", nil, err
		}
	case errors.Is(err, pgx.ErrNoRows):
		if _, err := tx.Exec(ctx, `INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)`, msgID, userID, emoji); err != nil {
			return "", nil, err
		}
	default:
		return "", nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", nil, err
	}
	reactions, err := s.ReactionsFor(ctx, msgID, userID)
	if err != nil {
		return "", nil, err
	}
	return emoji, reactions, nil
}

// ReactionsFor returns the aggregated reactions for a single message.
func (s *Store) ReactionsFor(ctx context.Context, msgID, meID int64) ([]models.ChatReaction, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT emoji, count(*)::int, bool_or(user_id=$2) AS mine
		FROM chat_reactions WHERE message_id=$1
		GROUP BY emoji ORDER BY count(*) DESC, emoji`, msgID, meID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ChatReaction
	for rows.Next() {
		var r models.ChatReaction
		if err := rows.Scan(&r.Emoji, &r.Count, &r.Mine); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// FillReactions attaches aggregated reactions to the given messages (one query).
func (s *Store) FillReactions(ctx context.Context, meID int64, msgs []models.ChatMessage) error {
	if len(msgs) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		if m.ID > 0 {
			ids = append(ids, m.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT message_id, emoji, count(*)::int, bool_or(user_id=$1) AS mine
		FROM chat_reactions WHERE message_id = ANY($2)
		GROUP BY message_id, emoji
		ORDER BY count(*) DESC, emoji`, meID, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	byMsg := map[int64][]models.ChatReaction{}
	for rows.Next() {
		var msgID int64
		var r models.ChatReaction
		if err := rows.Scan(&msgID, &r.Emoji, &r.Count, &r.Mine); err != nil {
			return err
		}
		byMsg[msgID] = append(byMsg[msgID], r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range msgs {
		if msgs[i].ID > 0 {
			msgs[i].Reactions = byMsg[msgs[i].ID]
		}
	}
	return nil
}

// ---- Notifications ----

func (s *Store) Notify(ctx context.Context, userID int64, category, typeStr, title, body, route string, data any) error {
	d, _ := json.Marshal(data)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notifications (user_id, category, type, title, body, route, data)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		userID, category, typeStr, title, body, route, d)
	return err
}

func (s *Store) CreateNotification(ctx context.Context, n *models.Notification) error {
	d := n.Data
	if d == nil {
		d = json.RawMessage(`{}`)
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO notifications (user_id, category, type, title, body, route, data)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
		n.UserID, n.Category, n.Type, n.Title, n.Body, n.Route, d).Scan(&n.ID, &n.CreatedAt)
	return err
}

func (s *Store) GetPrefs(ctx context.Context, userID int64) (*models.NotificationPrefs, error) {
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO notification_prefs (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return nil, err
	}
	var p models.NotificationPrefs
	if err := s.pool.QueryRow(ctx, `
		SELECT user_id, progress, gamification, mentor, event FROM notification_prefs WHERE user_id=$1`, userID).
		Scan(&p.UserID, &p.Progress, &p.Gamification, &p.Mentor, &p.Event); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) UpdatePrefs(ctx context.Context, p *models.NotificationPrefs) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notification_prefs (user_id, progress, gamification, mentor, event)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id) DO UPDATE SET progress=$2, gamification=$3, mentor=$4, event=$5`,
		p.UserID, p.Progress, p.Gamification, p.Mentor, p.Event)
	return err
}

func (s *Store) PrefEnabled(ctx context.Context, userID int64, category string) (bool, error) {
	var v bool
	err := s.pool.QueryRow(ctx, `
		SELECT CASE $2
			WHEN 'progress' THEN progress
			WHEN 'gamification' THEN gamification
			WHEN 'mentor' THEN mentor
			WHEN 'event' THEN event
		END FROM notification_prefs WHERE user_id=$1`, userID, category).Scan(&v)
	if err != nil {
		return true, nil
	}
	return v, nil
}

func (s *Store) ListNotifications(ctx context.Context, userID int64, limit, offset int) ([]models.Notification, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, user_id, category, type, title, body, route, data, read_at, created_at
		FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNotifications(rows)
}

func scanNotifications(rows pgx.Rows) ([]models.Notification, error) {
	var out []models.Notification
	for rows.Next() {
		var n models.Notification
		if err := rows.Scan(&n.ID, &n.UserID, &n.Category, &n.Type, &n.Title, &n.Body, &n.Route, &n.Data, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) UnreadCount(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL`, userID).Scan(&n)
	return n, err
}

func (s *Store) MarkRead(ctx context.Context, userID, notifID int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2`, notifID, userID)
	return err
}

func (s *Store) MarkAllRead(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, userID)
	return err
}

// ---- Reminders ----

func (s *Store) ReminderSent(ctx context.Context, userID int64, kind, ref string) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, `SELECT 1 FROM reminders_sent WHERE user_id=$1 AND kind=$2 AND ref=$3`, userID, kind, ref).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return true, err
}

func (s *Store) MarkReminderSent(ctx context.Context, userID int64, kind, ref string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO reminders_sent (user_id, kind, ref) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, userID, kind, ref)
	return err
}

// ---- Video assets ----

func (s *Store) CreateVideoAsset(ctx context.Context, key, mime string, size int64) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO video_assets (key, mime, size_bytes) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING`, key, mime, size)
	return err
}

type VideoAssetRow struct {
	Key       string
	Mime      string
	SizeBytes int64
	CreatedAt time.Time
}

func (s *Store) ListVideoAssets(ctx context.Context) ([]VideoAssetRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT key, mime, size_bytes, created_at
		FROM video_assets
		ORDER BY created_at DESC
		LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VideoAssetRow
	for rows.Next() {
		var v VideoAssetRow
		if err := rows.Scan(&v.Key, &v.Mime, &v.SizeBytes, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	if out == nil {
		out = []VideoAssetRow{}
	}
	return out, rows.Err()
}

func (s *Store) DeleteVideoAsset(ctx context.Context, key string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM video_assets WHERE key=$1`, key)
	return err
}

// ---- Refresh tokens ----

func (s *Store) CreateRefreshToken(ctx context.Context, userID int64, hash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`, userID, hash, expiresAt)
	return err
}

func (s *Store) RevokeRefreshToken(ctx context.Context, hash string) error {
	_, err := s.pool.Exec(ctx, `UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1`, hash)
	return err
}

func (s *Store) RevokeAllUserRefreshTokens(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at=now()
		WHERE user_id=$1 AND revoked_at IS NULL`, userID)
	return err
}

// ConsumeRefreshToken atomically revokes a valid refresh token and returns its
// user id plus the original lifetime (expires_at − created_at) so callers can
// preserve remember-me vs short session on rotation.
func (s *Store) ConsumeRefreshToken(ctx context.Context, hash string) (userID int64, lifetime time.Duration, ok bool, err error) {
	var expiresAt, createdAt time.Time
	err = s.pool.QueryRow(ctx, `
		UPDATE refresh_tokens
		SET revoked_at=now()
		WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()
		RETURNING user_id, expires_at, created_at`, hash).Scan(&userID, &expiresAt, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, err
	}
	lifetime = expiresAt.Sub(createdAt)
	if lifetime < 0 {
		lifetime = 0
	}
	return userID, lifetime, true, nil
}

func (s *Store) RefreshTokenValid(ctx context.Context, hash string) (int64, bool, error) {
	var userID int64
	var expiresAt, revokedAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash=$1`, hash).
		Scan(&userID, &expiresAt, &revokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	ok := (revokedAt == nil) && (expiresAt != nil && expiresAt.After(time.Now()))
	return userID, ok, nil
}

func (s *Store) PurgeOldHeartbeats(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	tag, err := s.pool.Exec(ctx, `DELETE FROM watch_heartbeats WHERE created_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ---- Announcements / stats ----

func (s *Store) AllActiveUserIDs(ctx context.Context) ([]int64, error) {
	rows, err := s.pool.Query(ctx, `SELECT id FROM users WHERE is_active`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) Stats(ctx context.Context) (map[string]any, error) {
	var users, lessons, questions, events, completions int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE role='student' AND is_active`).Scan(&users); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM lessons`).Scan(&lessons); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM mcq_questions`).Scan(&questions); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM events`).Scan(&events); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM lesson_progress WHERE passed_quiz`).Scan(&completions); err != nil {
		return nil, err
	}
	return map[string]any{
		"users": users, "lessons": lessons, "questions": questions,
		"events": events, "completions": completions,
	}, nil
}
