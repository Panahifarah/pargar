package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"pargar/backend/internal/models"
)

var (
	ErrInviteNotFound      = errors.New("invite not found")
	ErrInviteInvalid       = errors.New("invite invalid")
	ErrInvitePaused        = errors.New("invite paused")
	ErrInviteRevoked       = errors.New("invite revoked")
	ErrInviteExhausted     = errors.New("invite exhausted")
	ErrInviteExpired       = errors.New("invite expired")
	ErrInviteMaxUsesTooLow = errors.New("maxUses below used_count")
	ErrInviteMaxUsesRange  = errors.New("maxUses out of range")
)

const inviteCols = `id, token_hash, token_enc, label, max_uses, used_count, status,
	expires_at, created_by, created_at`

func HashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// EncryptInviteToken encrypts the raw invite token with AES-GCM keyed by secret.
func EncryptInviteToken(secret, plaintext string) (string, error) {
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	out := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawURLEncoding.EncodeToString(out), nil
}

// DecryptInviteToken decrypts a token produced by EncryptInviteToken.
func DecryptInviteToken(secret, ciphertext string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, sealed := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// NewInviteToken returns 32 random bytes encoded as base64url (no padding).
func NewInviteToken() (string, error) {
	b := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func inviteRemaining(maxUses, usedCount int, status models.InviteStatus) int {
	// Admin still sees remaining capacity while paused; revoked/exhausted show 0.
	if status != models.InviteActive && status != models.InvitePaused {
		return 0
	}
	rem := maxUses - usedCount
	if rem < 0 {
		return 0
	}
	return rem
}

func scanInvite(row rowScanner) (*models.RegistrationInvite, error) {
	var inv models.RegistrationInvite
	var tokenHash, tokenEnc, status string
	err := row.Scan(
		&inv.ID, &tokenHash, &tokenEnc, &inv.Label, &inv.MaxUses, &inv.UsedCount, &status,
		&inv.ExpiresAt, &inv.CreatedBy, &inv.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, err
	}
	inv.Status = models.InviteStatus(status)
	inv.Remaining = inviteRemaining(inv.MaxUses, inv.UsedCount, inv.Status)
	// Stash enc on Token temporarily for decrypt by callers that need it; clear before JSON if unused.
	inv.Token = tokenEnc
	return &inv, nil
}

func (s *Store) CreateRegistrationInvite(
	ctx context.Context,
	tokenHash, tokenEnc, label string,
	maxUses int,
	expiresAt *time.Time,
	createdBy int64,
) (*models.RegistrationInvite, error) {
	label = strings.TrimSpace(label)
	if utf8.RuneCountInString(label) > 120 {
		label = string([]rune(label)[:120])
	}
	if maxUses < 1 {
		return nil, errors.New("maxUses must be >= 1")
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO registration_invites (token_hash, token_enc, label, max_uses, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+inviteCols,
		tokenHash, tokenEnc, label, maxUses, expiresAt, createdBy)
	return scanInvite(row)
}

func (s *Store) ListRegistrationInvites(ctx context.Context, query string, limit, offset int) ([]models.RegistrationInvite, int64, error) {
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
		SELECT COUNT(*) FROM registration_invites
		WHERE ($1 = '' OR COALESCE(label, '') ILIKE '%'||$1||'%')`, query).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+inviteCols+`
		FROM registration_invites
		WHERE ($1 = '' OR COALESCE(label, '') ILIKE '%'||$1||'%')
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`, query, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []models.RegistrationInvite
	for rows.Next() {
		inv, err := scanInvite(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *inv)
	}
	return out, total, rows.Err()
}

func (s *Store) GetRegistrationInviteByID(ctx context.Context, id int64) (*models.RegistrationInvite, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+inviteCols+` FROM registration_invites WHERE id=$1`, id)
	return scanInvite(row)
}

func (s *Store) GetRegistrationInviteByTokenHash(ctx context.Context, tokenHash string) (*models.RegistrationInvite, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+inviteCols+` FROM registration_invites WHERE token_hash=$1`, tokenHash)
	return scanInvite(row)
}

func (s *Store) RevokeRegistrationInvite(ctx context.Context, id int64) (*models.RegistrationInvite, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE registration_invites
		SET status = 'revoked'
		WHERE id = $1 AND status IN ('active', 'paused')
		RETURNING `+inviteCols, id)
	inv, err := scanInvite(row)
	if err != nil {
		if errors.Is(err, ErrInviteNotFound) {
			existing, getErr := s.GetRegistrationInviteByID(ctx, id)
			if getErr != nil {
				return nil, getErr
			}
			return existing, ErrInviteInvalid
		}
		return nil, err
	}
	return inv, nil
}

func (s *Store) PauseRegistrationInvite(ctx context.Context, id int64) (*models.RegistrationInvite, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE registration_invites
		SET status = 'paused'
		WHERE id = $1 AND status = 'active'
		RETURNING `+inviteCols, id)
	inv, err := scanInvite(row)
	if err != nil {
		if errors.Is(err, ErrInviteNotFound) {
			existing, getErr := s.GetRegistrationInviteByID(ctx, id)
			if getErr != nil {
				return nil, getErr
			}
			return existing, ErrInviteInvalid
		}
		return nil, err
	}
	return inv, nil
}

func (s *Store) ResumeRegistrationInvite(ctx context.Context, id int64) (*models.RegistrationInvite, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE registration_invites
		SET status = 'active'
		WHERE id = $1 AND status = 'paused'
		  AND used_count < max_uses
		  AND (expires_at IS NULL OR expires_at > now())
		RETURNING `+inviteCols, id)
	inv, err := scanInvite(row)
	if err != nil {
		if errors.Is(err, ErrInviteNotFound) {
			existing, getErr := s.GetRegistrationInviteByID(ctx, id)
			if getErr != nil {
				return nil, getErr
			}
			if existing.Status != models.InvitePaused {
				return existing, ErrInviteInvalid
			}
			if existing.ExpiresAt != nil && !existing.ExpiresAt.After(time.Now()) {
				return existing, ErrInviteExpired
			}
			if existing.UsedCount >= existing.MaxUses {
				return existing, ErrInviteExhausted
			}
			return existing, ErrInviteInvalid
		}
		return nil, err
	}
	return inv, nil
}

// UpdateRegistrationInvite patches label, max uses, and/or expiry for an editable invite.
// When setExpires is true, expiresAt is applied (nil clears expiry).
func (s *Store) UpdateRegistrationInvite(
	ctx context.Context,
	id int64,
	label *string,
	maxUses *int,
	setExpires bool,
	expiresAt *time.Time,
) (*models.RegistrationInvite, error) {
	existing, err := s.GetRegistrationInviteByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.Status != models.InviteActive && existing.Status != models.InvitePaused {
		return existing, ErrInviteInvalid
	}

	newLabel := existing.Label
	if label != nil {
		newLabel = strings.TrimSpace(*label)
		if utf8.RuneCountInString(newLabel) > 120 {
			newLabel = string([]rune(newLabel)[:120])
		}
	}

	newMax := existing.MaxUses
	if maxUses != nil {
		if *maxUses < 1 || *maxUses > 10_000 {
			return nil, ErrInviteMaxUsesRange
		}
		if *maxUses < existing.UsedCount {
			return nil, ErrInviteMaxUsesTooLow
		}
		newMax = *maxUses
	}

	newExpires := existing.ExpiresAt
	if setExpires {
		newExpires = expiresAt
	}

	row := s.pool.QueryRow(ctx, `
		UPDATE registration_invites
		SET label = $2,
		    max_uses = $3,
		    expires_at = $4
		WHERE id = $1 AND status IN ('active', 'paused')
		RETURNING `+inviteCols,
		id, newLabel, newMax, newExpires)
	return scanInvite(row)
}

// EvaluateInviteAvailability checks whether an invite can still accept registrations.
func EvaluateInviteAvailability(inv *models.RegistrationInvite, now time.Time) error {
	if inv == nil {
		return ErrInviteNotFound
	}
	switch inv.Status {
	case models.InviteRevoked:
		return ErrInviteRevoked
	case models.InviteExhausted:
		return ErrInviteExhausted
	case models.InvitePaused:
		return ErrInvitePaused
	case models.InviteActive:
		// ok
	default:
		return ErrInviteInvalid
	}
	if inv.ExpiresAt != nil && !inv.ExpiresAt.After(now) {
		return ErrInviteExpired
	}
	if inv.UsedCount >= inv.MaxUses {
		return ErrInviteExhausted
	}
	return nil
}

// RegisterInviteStudent creates a student, consumes the IP, and atomically consumes one invite seat.
func (s *Store) RegisterInviteStudent(
	ctx context.Context,
	inviteID int64,
	name, email, username, passwordHash, phone, securityQuestion, securityAnswerHash, ip string,
) (*models.User, error) {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return nil, errors.New("empty registration ip")
	}
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

	var taken bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM registration_ips WHERE ip=$1)`, ip).Scan(&taken); err != nil {
		return nil, err
	}
	if taken {
		return nil, ErrRegistrationIPTaken
	}

	tag, err := tx.Exec(ctx, `
		UPDATE registration_invites
		SET used_count = used_count + 1,
		    status = CASE
		      WHEN used_count + 1 >= max_uses THEN 'exhausted'
		      ELSE status
		    END
		WHERE id = $1
		  AND status = 'active'
		  AND used_count < max_uses
		  AND (expires_at IS NULL OR expires_at > now())`, inviteID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		var status string
		var used, maxUses int
		var expiresAt *time.Time
		err := tx.QueryRow(ctx, `
			SELECT status, used_count, max_uses, expires_at
			FROM registration_invites WHERE id=$1`, inviteID).Scan(&status, &used, &maxUses, &expiresAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInviteNotFound
		}
		if err != nil {
			return nil, err
		}
		switch models.InviteStatus(status) {
		case models.InviteRevoked:
			return nil, ErrInviteRevoked
		case models.InviteExhausted:
			return nil, ErrInviteExhausted
		case models.InvitePaused:
			return nil, ErrInvitePaused
		}
		if expiresAt != nil && !expiresAt.After(time.Now()) {
			return nil, ErrInviteExpired
		}
		if used >= maxUses {
			return nil, ErrInviteExhausted
		}
		return nil, ErrInviteInvalid
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
	// Consume whitelist seat if this phone was listed (invite may use non-whitelist phones).
	if err := consumeWhitelistPhoneTx(ctx, tx, phone, u.ID, false); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_prefs (user_id) VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING`, u.ID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO registration_ips (ip, user_id) VALUES ($1, $2)`, ip, u.ID); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrRegistrationIPTaken
		}
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return u, nil
}
