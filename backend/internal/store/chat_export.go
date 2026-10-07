package store

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"pargar/backend/internal/models"
)

var (
	ErrChatExportTokenNotFound = errors.New("chat export token not found")
	ErrChatExportTokenRevoked  = errors.New("chat export token revoked")
	ErrChatExportTokenExpired  = errors.New("chat export token expired")
	ErrChatExportTokenUsed     = errors.New("chat export token already used")
	ErrChatExportTokenInvalid  = errors.New("chat export token invalid")
)

const chatExportTokenCols = `id, token_hash, token_enc, label, expires_at, revoked_at, used_at,
	created_by, created_at, last_used_at`

// ChatExportPair is one student↔mentor conversation found in chat_messages.
type ChatExportPair struct {
	StudentID   int64
	StudentName string
	MentorID    int64
	MentorName  string
}

// ChatExportStats is an approximate size summary for the full chat archive.
type ChatExportStats struct {
	ConversationCount int64 `json:"conversationCount"`
	MessageCount      int64 `json:"messageCount"`
	AttachmentBytes   int64 `json:"attachmentBytes"`
	BodyBytes         int64 `json:"bodyBytes"`
	// EstimatedBytes is a rough upper-bound for the ZIP (attachments + compressed text overhead).
	EstimatedBytes int64 `json:"estimatedBytes"`
}

// ChatExportStats returns approximate totals for the project-wide chat archive.
func (s *Store) ChatExportStats(ctx context.Context) (*ChatExportStats, error) {
	var st ChatExportStats
	err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT COUNT(*) FROM (SELECT DISTINCT user_id, mentor_id FROM chat_messages) p), 0),
			COUNT(*),
			COALESCE(SUM(COALESCE(attachment_size, 0)), 0),
			COALESCE(SUM(OCTET_LENGTH(COALESCE(body, ''))), 0)
		FROM chat_messages`).Scan(
		&st.ConversationCount,
		&st.MessageCount,
		&st.AttachmentBytes,
		&st.BodyBytes,
	)
	if err != nil {
		return nil, err
	}
	// Text/JSON compresses well in ZIP; media usually does not. Bias toward a safe upper bound.
	const perMessageJSON int64 = 160
	const perConversationJSON int64 = 120
	const zipEnvelope int64 = 4096
	textPacked := st.BodyBytes/2 + st.MessageCount*perMessageJSON + st.ConversationCount*perConversationJSON + zipEnvelope
	st.EstimatedBytes = st.AttachmentBytes + textPacked
	return &st, nil
}

// ListChatExportPairs returns every distinct conversation pair with display names.
func (s *Store) ListChatExportPairs(ctx context.Context) ([]ChatExportPair, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT m.user_id, COALESCE(su.name, ''), m.mentor_id, COALESCE(mu.name, '')
		FROM (
			SELECT DISTINCT user_id, mentor_id FROM chat_messages
		) m
		LEFT JOIN users su ON su.id = m.user_id
		LEFT JOIN users mu ON mu.id = m.mentor_id
		ORDER BY m.user_id, m.mentor_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChatExportPair
	for rows.Next() {
		var p ChatExportPair
		if err := rows.Scan(&p.StudentID, &p.StudentName, &p.MentorID, &p.MentorName); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func chatExportTokenActive(tok *models.ChatExportToken, now time.Time) bool {
	return tok != nil && tok.RevokedAt == nil && tok.UsedAt == nil && tok.ExpiresAt.After(now)
}

func scanChatExportToken(row rowScanner) (*models.ChatExportToken, error) {
	var tok models.ChatExportToken
	var tokenHash, tokenEnc string
	err := row.Scan(
		&tok.ID, &tokenHash, &tokenEnc, &tok.Label, &tok.ExpiresAt, &tok.RevokedAt, &tok.UsedAt,
		&tok.CreatedBy, &tok.CreatedAt, &tok.LastUsedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrChatExportTokenNotFound
	}
	if err != nil {
		return nil, err
	}
	tok.Active = chatExportTokenActive(&tok, time.Now().UTC())
	// Stash enc on Token for decrypt by callers; clear/replace before JSON if unused.
	tok.Token = tokenEnc
	return &tok, nil
}

func (s *Store) CreateChatExportToken(
	ctx context.Context,
	tokenHash, tokenEnc, label string,
	expiresAt time.Time,
	createdBy int64,
) (*models.ChatExportToken, error) {
	label = strings.TrimSpace(label)
	if utf8.RuneCountInString(label) > 120 {
		label = string([]rune(label)[:120])
	}
	if expiresAt.IsZero() || !expiresAt.After(time.Now().UTC()) {
		return nil, errors.New("expiresAt must be in the future")
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO chat_export_tokens (token_hash, token_enc, label, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+chatExportTokenCols,
		tokenHash, tokenEnc, label, expiresAt.UTC(), createdBy)
	return scanChatExportToken(row)
}

func (s *Store) ListChatExportTokens(ctx context.Context, limit int) ([]models.ChatExportToken, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+chatExportTokenCols+`
		FROM chat_export_tokens
		ORDER BY created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.ChatExportToken
	for rows.Next() {
		tok, err := scanChatExportToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *tok)
	}
	return out, rows.Err()
}

func (s *Store) GetChatExportTokenByHash(ctx context.Context, tokenHash string) (*models.ChatExportToken, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+chatExportTokenCols+`
		FROM chat_export_tokens WHERE token_hash=$1`, tokenHash)
	return scanChatExportToken(row)
}

func (s *Store) GetChatExportTokenByID(ctx context.Context, id int64) (*models.ChatExportToken, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+chatExportTokenCols+`
		FROM chat_export_tokens WHERE id=$1`, id)
	return scanChatExportToken(row)
}

// ValidateChatExportToken returns nil when the token is active (not revoked, unused, not expired).
func ValidateChatExportToken(tok *models.ChatExportToken, now time.Time) error {
	if tok == nil {
		return ErrChatExportTokenNotFound
	}
	if tok.RevokedAt != nil {
		return ErrChatExportTokenRevoked
	}
	if tok.UsedAt != nil {
		return ErrChatExportTokenUsed
	}
	if !tok.ExpiresAt.After(now) {
		return ErrChatExportTokenExpired
	}
	return nil
}

// ConsumeChatExportToken marks a token used atomically (single-use download links).
func (s *Store) ConsumeChatExportToken(ctx context.Context, id int64) (*models.ChatExportToken, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE chat_export_tokens
		SET used_at = now(), last_used_at = now()
		WHERE id = $1
		  AND revoked_at IS NULL
		  AND used_at IS NULL
		  AND expires_at > now()
		RETURNING `+chatExportTokenCols, id)
	tok, err := scanChatExportToken(row)
	if err != nil {
		if errors.Is(err, ErrChatExportTokenNotFound) {
			existing, getErr := s.GetChatExportTokenByID(ctx, id)
			if getErr != nil {
				return nil, getErr
			}
			if err := ValidateChatExportToken(existing, time.Now().UTC()); err != nil {
				return existing, err
			}
			return existing, ErrChatExportTokenInvalid
		}
		return nil, err
	}
	return tok, nil
}

func (s *Store) RevokeChatExportToken(ctx context.Context, id int64) (*models.ChatExportToken, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE chat_export_tokens
		SET revoked_at = now()
		WHERE id = $1 AND revoked_at IS NULL
		RETURNING `+chatExportTokenCols, id)
	tok, err := scanChatExportToken(row)
	if err != nil {
		if errors.Is(err, ErrChatExportTokenNotFound) {
			existing, getErr := s.GetChatExportTokenByID(ctx, id)
			if getErr != nil {
				return nil, getErr
			}
			return existing, ErrChatExportTokenInvalid
		}
		return nil, err
	}
	return tok, nil
}
