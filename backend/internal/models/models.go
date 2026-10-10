package models

import (
	"encoding/json"
	"time"
)

type Role string

const (
	RoleStudent Role = "student"
	RoleMentor  Role = "mentor"
	RoleAdmin   Role = "admin"
)

func (r Role) String() string { return string(r) }

// IsStaff reports whether the role is exempt from student heart/lockout limits.
func (r Role) IsStaff() bool {
	return r == RoleAdmin || r == RoleMentor
}

type User struct {
	ID                       int64      `json:"id"`
	Email                    string     `json:"email"`
	Username                 string     `json:"username"`
	PasswordHash             string     `json:"-"`
	Name                     string     `json:"name"`
	Role                     Role       `json:"role"`
	XP                       int        `json:"xp"`
	Hearts                   int        `json:"hearts"`
	HeartsUpdatedAt          time.Time  `json:"heartsUpdatedAt"`
	StreakCurrent            int        `json:"streakCurrent"`
	StreakLongest            int        `json:"streakLongest"`
	LastActivityDate         *time.Time `json:"lastActivityDate,omitempty"`
	IsLocked                 bool       `json:"isLocked"`
	LockedAt                 *time.Time `json:"lockedAt,omitempty"`
	UnlockedBy               *int64     `json:"unlockedBy,omitempty"`
	IsActive                 bool       `json:"isActive"`
	AvatarVariant            string     `json:"avatarVariant"`
	AvatarPalette            string     `json:"avatarPalette"`
	AvatarPhoto              string     `json:"avatarPhoto,omitempty"`
	Phone                    string     `json:"phone"`
	TelegramID               *int64     `json:"-"`
	TelegramUsername         string     `json:"-"`
	SecurityQuestion         string     `json:"securityQuestion,omitempty"`
	SecurityAnswerHash       string     `json:"-"`
	HasSecurityAnswer        bool       `json:"hasSecurityAnswer"`
	CreatedAt                time.Time  `json:"createdAt"`
	UsernameChangeCount      int        `json:"-"`
	UsernameCooldownUntil    *time.Time `json:"usernameCooldownUntil,omitempty"`
	UsernameChangesRemaining int        `json:"usernameChangesRemaining"`
	FrozenAt                 *time.Time `json:"frozenAt,omitempty"`
	ClosedAt                 *time.Time `json:"closedAt,omitempty"`
	IsFrozen                 bool       `json:"isFrozen"`
	IsClosed                 bool       `json:"isClosed"`
	ClosesAt                 *time.Time `json:"closesAt,omitempty"`
}

const (
	UsernameChangeLimit    = 3
	UsernameChangeCooldown = 7 * 24 * time.Hour
	AccountFreezeGraceDays = 30
)

// ApplyUsernameQuota fills UsernameChangesRemaining from the stored count.
// An expired cooldown clears the allowance so the next window starts at the limit.
func (u *User) ApplyUsernameQuota(now time.Time) {
	if u.UsernameCooldownUntil != nil && !now.Before(*u.UsernameCooldownUntil) {
		u.UsernameChangeCount = 0
		u.UsernameCooldownUntil = nil
	}
	if u.UsernameCooldownUntil != nil && now.Before(*u.UsernameCooldownUntil) {
		u.UsernameChangesRemaining = 0
		return
	}
	remaining := UsernameChangeLimit - u.UsernameChangeCount
	if remaining < 0 {
		remaining = 0
	}
	u.UsernameChangesRemaining = remaining
}

// ApplyFreezeState derives freeze and closure from frozen_at and closed_at.
// Frozen is frozen_at set, closed_at empty, and now still inside the 30-day window.
// Closed is closed_at set, or the window having elapsed.
func (u *User) ApplyFreezeState(now time.Time) {
	u.IsFrozen = false
	u.IsClosed = false
	u.ClosesAt = nil
	if u.ClosedAt != nil {
		u.IsClosed = true
		return
	}
	if u.FrozenAt == nil {
		return
	}
	closes := u.FrozenAt.AddDate(0, 0, AccountFreezeGraceDays)
	if !now.Before(closes) {
		u.IsClosed = true
		return
	}
	u.IsFrozen = true
	u.ClosesAt = &closes
}

type Certificate struct {
	ID        int64      `json:"id"`
	UserID    int64      `json:"userId"`
	PublicID  string     `json:"publicId"`
	FullName  string     `json:"fullName"`
	IssuedAt  time.Time  `json:"issuedAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

type PhysicalOrderStatus string

const (
	PhysicalRequested PhysicalOrderStatus = "requested"
	PhysicalPaid      PhysicalOrderStatus = "paid"
	PhysicalShipped   PhysicalOrderStatus = "shipped"
	PhysicalCancelled PhysicalOrderStatus = "cancelled"
)

type CertificatePhysicalOrder struct {
	ID            int64               `json:"id"`
	CertificateID int64               `json:"certificateId"`
	UserID        int64               `json:"userId"`
	Status        PhysicalOrderStatus `json:"status"`
	Note          string              `json:"note"`
	RecipientName string              `json:"recipientName"`
	Phone         string              `json:"phone"`
	Address       string              `json:"address"`
	City          string              `json:"city"`
	PostalCode    string              `json:"postalCode"`
	TrackingCode  string              `json:"trackingCode"`
	WindowEndsAt  time.Time           `json:"windowEndsAt"`
	CreatedAt     time.Time           `json:"createdAt"`
	UpdatedAt     time.Time           `json:"updatedAt"`
	UserName      string              `json:"userName,omitempty"`
	PublicID      string              `json:"publicId,omitempty"`
}

type UnlockRequest struct {
	ID         int64      `json:"id"`
	UserID     int64      `json:"userId"`
	Note       string     `json:"note"`
	CreatedAt  time.Time  `json:"createdAt"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
	UserName   string     `json:"userName,omitempty"`
}

type NotificationPrefs struct {
	UserID       int64 `json:"userId"`
	Progress     bool  `json:"progress"`
	Gamification bool  `json:"gamification"`
	Mentor       bool  `json:"mentor"`
	Event        bool  `json:"event"`
}

type Chapter struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	SortOrder   int    `json:"sortOrder"`
}

type Lesson struct {
	ID                     int64  `json:"id"`
	ChapterID              int64  `json:"chapterId"`
	Title                  string `json:"title"`
	Description            string `json:"description"`
	VideoKey               string `json:"videoKey"`
	DurationSeconds        int    `json:"durationSeconds"`
	CompletionThresholdPct int    `json:"completionThresholdPct"`
	RequiresLessonID       *int64 `json:"requiresLessonId,omitempty"`
	X                      int    `json:"x"`
	Y                      int    `json:"y"`
	SortOrder              int    `json:"sortOrder"`
	XPReward               int    `json:"xpReward"`
	IsActive               bool   `json:"isActive"`
}

type MCQQuestion struct {
	ID          int64    `json:"id"`
	LessonID    int64    `json:"lessonId"`
	Position    int      `json:"position"`
	Question    string   `json:"question"`
	Options     []string `json:"options"`
	AnswerIndex int      `json:"answerIndex"`
	Explanation string   `json:"explanation"`
}

type LessonProgress struct {
	UserID          int64      `json:"userId"`
	LessonID        int64      `json:"lessonId"`
	WatchedSeconds  float64    `json:"watchedSeconds"`
	WatchedPct      float64    `json:"watchedPct"`
	LastPosition    float64    `json:"lastPosition"`
	QuizUnlocked    bool       `json:"quizUnlocked"`
	PassedQuiz      bool       `json:"passedQuiz"`
	QuizCompletedAt *time.Time `json:"quizCompletedAt,omitempty"`
}

type WatchSession struct {
	ID              int64     `json:"id"`
	UserID          int64     `json:"userId"`
	LessonID        int64     `json:"lessonId"`
	StartedAt       time.Time `json:"startedAt"`
	LastHeartbeatAt time.Time `json:"lastHeartbeatAt"`
	LastPosition    float64   `json:"lastPosition"`
}

type QuizQuestionView struct {
	ID       int64    `json:"id"`
	Position int      `json:"position"`
	Question string   `json:"question"`
	Options  []string `json:"options"`
}

type QuizAttempt struct {
	ID           int64      `json:"id"`
	UserID       int64      `json:"userId"`
	LessonID     int64      `json:"lessonId"`
	Answers      []int      `json:"-"`
	CorrectCount int        `json:"correctCount"`
	Total        int        `json:"total"`
	ScorePct     float64    `json:"scorePct"`
	Status       string     `json:"status"`
	HeartsLost   int        `json:"heartsLost"`
	PassedAt     *time.Time `json:"passedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type Event struct {
	ID          int64     `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	EventType   string    `json:"eventType"`
	ExternalURL string    `json:"externalUrl"`
	StartsAt    time.Time `json:"startsAt"`
	EndsAt      time.Time `json:"endsAt"`
	IsActive    bool      `json:"isActive"`
	CreatedAt   time.Time `json:"createdAt"`
	CreatedBy   *int64    `json:"-"`
	Rsvped      bool      `json:"rsvped,omitempty"`
}

// Challenge is a timed XP goal (typically monthly) for students.
type Challenge struct {
	ID          int64     `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	TargetXP    int       `json:"targetXp"`
	StartsAt    time.Time `json:"startsAt"`
	EndsAt      time.Time `json:"endsAt"`
	IsActive    bool      `json:"isActive"`
	CreatedAt   time.Time `json:"createdAt"`
	CreatedBy   *int64    `json:"-"`
	// Progress fields for the requesting student (optional).
	MyXP      int  `json:"myXp,omitempty"`
	Completed bool `json:"completed,omitempty"`
}

type ChatMessage struct {
	ID          int64           `json:"id"`
	UserID      int64           `json:"userId"`
	MentorID    int64           `json:"mentorId"`
	SenderRole  Role            `json:"senderRole"`
	Body        string          `json:"body"`
	ReadAt      *time.Time      `json:"readAt,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	ReplyTo     *int64          `json:"replyTo,omitempty"`
	PinnedAt    *time.Time      `json:"pinnedAt,omitempty"`
	Pinned      bool            `json:"pinned"`
	EditedAt    *time.Time      `json:"editedAt,omitempty"`
	Attachment  *Attachment     `json:"attachment,omitempty"`
	Attachments []Attachment    `json:"attachments,omitempty"`
	Reactions   []ChatReaction  `json:"reactions,omitempty"`
	Buttons     json.RawMessage `json:"buttons,omitempty"`
}

type ChatReaction struct {
	Emoji string `json:"emoji"`
	Count int    `json:"count"`
	Mine  bool   `json:"mine"`
}

type Attachment struct {
	Type string `json:"type"` // image | video | audio | file
	URL  string `json:"url"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type Notification struct {
	ID        int64           `json:"id"`
	UserID    int64           `json:"userId"`
	Category  string          `json:"category"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Route     string          `json:"route"`
	Data      json.RawMessage `json:"data"`
	ReadAt    *time.Time      `json:"readAt,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
}

type InviteStatus string

const (
	InviteActive    InviteStatus = "active"
	InvitePaused    InviteStatus = "paused"
	InviteRevoked   InviteStatus = "revoked"
	InviteExhausted InviteStatus = "exhausted"
)

// RegistrationInvite is a capacity-limited membership registration link.
type RegistrationInvite struct {
	ID        int64        `json:"id"`
	Label     string       `json:"label"`
	MaxUses   int          `json:"maxUses"`
	UsedCount int          `json:"usedCount"`
	Remaining int          `json:"remaining"`
	Status    InviteStatus `json:"status"`
	ExpiresAt *time.Time   `json:"expiresAt,omitempty"`
	CreatedBy *int64       `json:"createdBy,omitempty"`
	CreatedAt time.Time    `json:"createdAt"`
	// Token is the raw invite token; only populated when decrypting for admin URL display.
	Token string `json:"token,omitempty"`
	URL   string `json:"url,omitempty"`
}

// ChatExportToken is a time-limited, single-use download link for the project chat archive.
type ChatExportToken struct {
	ID         int64      `json:"id"`
	Label      string     `json:"label"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	UsedAt     *time.Time `json:"usedAt,omitempty"`
	CreatedBy  *int64     `json:"createdBy,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	Active     bool       `json:"active"`
	// Token/URL are populated for admin display after decrypt.
	Token string `json:"token,omitempty"`
	URL   string `json:"url,omitempty"`
}

type WhitelistStatus string

const (
	WhitelistAvailable WhitelistStatus = "available"
	WhitelistConsumed  WhitelistStatus = "consumed"
)

// RegistrationPhoneWhitelist is a one-shot phone allowed for public registration.
type RegistrationPhoneWhitelist struct {
	ID             int64           `json:"id"`
	Phone          string          `json:"phone"`
	Status         WhitelistStatus `json:"status"`
	ConsumedAt     *time.Time      `json:"consumedAt,omitempty"`
	ConsumedUserID *int64          `json:"consumedUserId,omitempty"`
	CreatedBy      *int64          `json:"createdBy,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// RegistrationPhoneBlacklist blocks a phone from all registration paths.
type RegistrationPhoneBlacklist struct {
	ID        int64     `json:"id"`
	Phone     string    `json:"phone"`
	CreatedBy *int64    `json:"createdBy,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// RegistrationBlacklistAttempt records a failed registration try with a blacklisted phone.
type RegistrationBlacklistAttempt struct {
	ID                int64     `json:"id"`
	Phone             string    `json:"phone"`
	Path              string    `json:"path"` // public | invite
	InviteID          *int64    `json:"inviteId,omitempty"`
	IP                string    `json:"ip"`
	UserAgent         string    `json:"userAgent,omitempty"`
	AttemptedUsername string    `json:"attemptedUsername,omitempty"`
	AttemptedEmail    string    `json:"attemptedEmail,omitempty"`
	AttemptedAt       time.Time `json:"attemptedAt"`
}
