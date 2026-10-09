package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"pargar/backend/internal/service"
)

type lbEntry struct {
	UserID        int64   `json:"userId"`
	Name          string  `json:"name"`
	Email         string  `json:"email"`
	XP            float64 `json:"xp"`
	Rank          int     `json:"rank"`
	AvatarVariant string  `json:"avatarVariant"`
	AvatarPalette string  `json:"avatarPalette"`
	AvatarPhoto   string  `json:"avatarPhoto,omitempty"`
}

func (s *Server) handleWeeklyLeaderboard(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	key := "lb:" + service.ISOWeek(time.Now())

	entries := make([]lbEntry, 0, 20)
	type scored struct {
		userID int64
		xp     float64
	}
	var scoredList []scored

	if s.redis != nil {
		z, err := s.redis.ZRevRangeWithScores(context.Background(), key, 0, 19).Result()
		if err == nil {
			for _, member := range z {
				id, _ := strconv.ParseInt(member.Member.(string), 10, 64)
				scoredList = append(scoredList, scored{userID: id, xp: member.Score})
			}
		}
	}

	// fallback to DB if redis empty (e.g. dev bootstrap)
	if len(scoredList) == 0 {
		rows, err := s.store.Pool().Query(context.Background(), `
			SELECT user_id, xp FROM weekly_leaderboard WHERE week=$1 ORDER BY xp DESC LIMIT 20`,
			service.ISOWeek(time.Now()))
		if err == nil {
			for rows.Next() {
				var id int64
				var xp int
				if rows.Scan(&id, &xp) == nil {
					scoredList = append(scoredList, scored{userID: id, xp: float64(xp)})
				}
			}
			rows.Close()
		}
	}

	for i, sc := range scoredList {
		usr, err := s.store.GetUserByID(context.Background(), sc.userID)
		if err != nil {
			continue
		}
		s.signUserMedia(usr)
		entries = append(entries, lbEntry{
			UserID: sc.userID, Name: usr.Name, Email: usr.Email, XP: sc.xp, Rank: i + 1,
			AvatarVariant: usr.AvatarVariant, AvatarPalette: usr.AvatarPalette, AvatarPhoto: usr.AvatarPhoto,
		})
	}

	// my position
	myRank := -1
	var myXP float64
	if s.redis != nil {
		rank, err := s.redis.ZRevRank(context.Background(), key, strconv.FormatInt(u.ID, 10)).Result()
		if err == nil {
			myRank = int(rank) + 1
		}
		score, err := s.redis.ZScore(context.Background(), key, strconv.FormatInt(u.ID, 10)).Result()
		if err == nil {
			myXP = score
		}
	}

	if entries == nil {
		entries = []lbEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"week":    service.ISOWeek(time.Now()),
		"entries": entries,
		"me":      map[string]any{"rank": myRank, "xp": myXP, "streak": u.StreakCurrent},
	})
}
