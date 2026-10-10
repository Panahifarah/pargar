package store

import (
	"context"
	"encoding/json"
	"time"
)

type Announcement struct {
	ID        int64
	Title     string
	Body      string
	Category  string
	Route     string
	Pinned    bool
	CreatedBy int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (s *Store) CreateAnnouncement(ctx context.Context, a *Announcement) error {
	if a.Pinned {
		_, _ = s.pool.Exec(ctx, `UPDATE announcements SET pinned=false WHERE pinned`)
	}
	return s.pool.QueryRow(ctx, `
		INSERT INTO announcements (title, body, category, route, pinned, created_by)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, created_at, updated_at`,
		a.Title, a.Body, a.Category, a.Route, a.Pinned, a.CreatedBy,
	).Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt)
}

func (s *Store) ListAnnouncements(ctx context.Context) ([]Announcement, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, body, category, route, pinned, COALESCE(created_by,0), created_at, updated_at
		FROM announcements ORDER BY pinned DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Announcement
	for rows.Next() {
		var a Announcement
		if err := rows.Scan(&a.ID, &a.Title, &a.Body, &a.Category, &a.Route, &a.Pinned, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) UpdateAnnouncement(ctx context.Context, a Announcement) error {
	if a.Pinned {
		_, _ = s.pool.Exec(ctx, `UPDATE announcements SET pinned=false WHERE pinned AND id<>$1`, a.ID)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE announcements
		SET title=$2, body=$3, category=$4, route=$5, pinned=$6, updated_at=now()
		WHERE id=$1`, a.ID, a.Title, a.Body, a.Category, a.Route, a.Pinned)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE notifications
		SET title=$2, body=$3, category=$4::notif_category, route=$5
		WHERE announcement_id=$1`, a.ID, a.Title, a.Body, a.Category, a.Route)
	return err
}

func (s *Store) DeleteAnnouncement(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM announcements WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RecentAnnouncements(ctx context.Context, limit int) ([]Announcement, error) {
	if limit <= 0 || limit > 20 {
		limit = 8
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, body, category, route, pinned, COALESCE(created_by,0), created_at, updated_at
		FROM announcements ORDER BY pinned DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Announcement
	for rows.Next() {
		var a Announcement
		if err := rows.Scan(&a.ID, &a.Title, &a.Body, &a.Category, &a.Route, &a.Pinned, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) PinnedAnnouncement(ctx context.Context) (*Announcement, error) {
	var a Announcement
	err := s.pool.QueryRow(ctx, `
		SELECT id, title, body, category, route, pinned, COALESCE(created_by,0), created_at, updated_at
		FROM announcements WHERE pinned ORDER BY updated_at DESC LIMIT 1`).
		Scan(&a.ID, &a.Title, &a.Body, &a.Category, &a.Route, &a.Pinned, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Store) AttachAnnouncement(ctx context.Context, notifID, announcementID int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE notifications SET announcement_id=$2 WHERE id=$1`, notifID, announcementID)
	return err
}

type ChatPref struct {
	PinnedRank *int
	Muted      bool
	Archived   bool
}

func (s *Store) UpsertChatPref(ctx context.Context, userID, partnerID int64, rank *int, muted, archived bool) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO chat_prefs (user_id, partner_id, pinned_rank, muted, archived)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, partner_id) DO UPDATE
		SET pinned_rank=$3, muted=$4, archived=$5`, userID, partnerID, rank, muted, archived)
	return err
}

func (s *Store) ChatPref(ctx context.Context, userID, partnerID int64) ChatPref {
	var p ChatPref
	_ = s.pool.QueryRow(ctx, `
		SELECT pinned_rank, muted, archived FROM chat_prefs WHERE user_id=$1 AND partner_id=$2`,
		userID, partnerID).Scan(&p.PinnedRank, &p.Muted, &p.Archived)
	return p
}

func (s *Store) SetChatMutedAll(ctx context.Context, userID int64, muted bool) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET chat_muted_all=$2 WHERE id=$1`, userID, muted)
	return err
}

func (s *Store) ChatMutedAll(ctx context.Context, userID int64) bool {
	var v bool
	_ = s.pool.QueryRow(ctx, `SELECT chat_muted_all FROM users WHERE id=$1`, userID).Scan(&v)
	return v
}

func (s *Store) TouchLastSeen(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_seen_at = now() WHERE id=$1`, userID)
	return err
}

func (s *Store) LastSeenByIDs(ctx context.Context, ids []int64) (map[int64]time.Time, error) {
	out := map[int64]time.Time{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, last_seen_at FROM users
		WHERE id = ANY($1::bigint[]) AND last_seen_at IS NOT NULL`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var ts time.Time
		if err := rows.Scan(&id, &ts); err != nil {
			return nil, err
		}
		out[id] = ts
	}
	return out, rows.Err()
}

func (s *Store) MarkChatUnread(ctx context.Context, meID, partnerID int64, meRole string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE chat_messages SET read_at=NULL
		WHERE read_at IS NOT NULL
		  AND sender_role <> $3
		  AND ((user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1))`,
		meID, partnerID, meRole)
	return err
}

func (s *Store) DeleteChatBoth(ctx context.Context, a, b int64) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM chat_messages
		WHERE (user_id=$1 AND mentor_id=$2) OR (user_id=$2 AND mentor_id=$1)`, a, b)
	return err
}

func (s *Store) SaveMessage(ctx context.Context, userID int64, body, url, kind, name string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO saved_messages (user_id, body, attachment_url, attachment_type, attachment_name)
		VALUES ($1,$2,$3,$4,$5)`, userID, body, url, kind, name)
	return err
}

func (s *Store) ListSaved(ctx context.Context, userID int64) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, body, attachment_url, attachment_type, attachment_name, created_at
		FROM saved_messages WHERE user_id=$1 ORDER BY id DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var body, url, kind, name string
		var at time.Time
		if err := rows.Scan(&id, &body, &url, &kind, &name, &at); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "body": body, "attachmentUrl": url, "attachmentType": kind, "attachmentName": name, "createdAt": at,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, rows.Err()
}

type ProfileExtras struct {
	Banner       string
	Public       bool
	ShowActivity bool
	ShowStats    bool
	ShowPath     bool
	ShowBadges   bool
	SocialLinks  json.RawMessage
	Theme        string
}

func (s *Store) EnsureProfile(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID)
	return err
}

func (s *Store) GetProfileExtras(ctx context.Context, userID int64) (ProfileExtras, error) {
	if err := s.EnsureProfile(ctx, userID); err != nil {
		return ProfileExtras{}, err
	}
	var p ProfileExtras
	err := s.pool.QueryRow(ctx, `
		SELECT banner_photo, profile_public, show_activity, show_stats, show_path, show_badges, social_links, theme
		FROM user_profiles WHERE user_id=$1`, userID).
		Scan(&p.Banner, &p.Public, &p.ShowActivity, &p.ShowStats, &p.ShowPath, &p.ShowBadges, &p.SocialLinks, &p.Theme)
	return p, err
}

func (s *Store) SaveProfileExtras(ctx context.Context, userID int64, p ProfileExtras) error {
	if err := s.EnsureProfile(ctx, userID); err != nil {
		return err
	}
	if len(p.SocialLinks) == 0 {
		p.SocialLinks = json.RawMessage(`[]`)
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE user_profiles SET
			banner_photo=$2, profile_public=$3, show_activity=$4, show_stats=$5,
			show_path=$6, show_badges=$7, social_links=$8, theme=$9
		WHERE user_id=$1`,
		userID, p.Banner, p.Public, p.ShowActivity, p.ShowStats, p.ShowPath, p.ShowBadges, p.SocialLinks, p.Theme)
	return err
}
