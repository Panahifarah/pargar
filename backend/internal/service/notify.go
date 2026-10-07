package service

import (
	"context"

	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

// Pusher delivers realtime messages to a user's connected websockets.
type Pusher interface {
	Push(userID int64, msg any)
}

// Notifier persists in-app notifications and pushes them live.
type Notifier struct {
	store  *store.Store
	pusher Pusher
}

func NewNotifier(st *store.Store, pusher Pusher) *Notifier {
	return &Notifier{store: st, pusher: pusher}
}

func (n *Notifier) Notify(ctx context.Context, userID int64, category, typ, title, body, route string, data any) error {
	enabled, err := n.store.PrefEnabled(ctx, userID, category)
	if err != nil || !enabled {
		return nil
	}
	notif := &models.Notification{
		UserID:   userID,
		Category: category,
		Type:     typ,
		Title:    title,
		Body:     body,
		Route:    route,
	}
	if data != nil {
		notif.Data = mustJSON(data)
	}
	if err := n.store.CreateNotification(ctx, notif); err != nil {
		return err
	}
	if n.pusher != nil {
		n.pusher.Push(userID, map[string]any{
			"type":   "notification",
			"unread": true,
			"item":   notif,
		})
	}
	return nil
}

func (n *Notifier) NotifyMany(ctx context.Context, userIDs []int64, category, typ, title, body, route string, data any) error {
	for _, uid := range userIDs {
		if err := n.Notify(ctx, uid, category, typ, title, body, route, data); err != nil {
			return err
		}
	}
	return nil
}
