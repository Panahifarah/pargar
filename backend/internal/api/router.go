package api

import (
	"net/http"

	"pargar/backend/internal/models"
)

func newRouter(s *Server) http.Handler {
	mux := http.NewServeMux()

	// ---- public ----
	mux.HandleFunc("GET /api/auth/captcha", s.authRateLimit(captchaRateLimit, "captcha", s.handleCaptcha))
	mux.HandleFunc("POST /api/auth/login", s.authRateLimit(loginBaseLimit, "login", s.handleLogin))
	mux.HandleFunc("POST /api/auth/refresh", s.authRateLimit(refreshRateLimit, "refresh", s.handleRefresh))
	mux.HandleFunc("POST /api/auth/recovery/challenge", s.authRateLimit(loginBaseLimit, "recovery", s.handleRecoveryChallenge))
	mux.HandleFunc("POST /api/auth/recovery/reset", s.authRateLimit(loginBaseLimit, "recovery", s.handleRecoveryReset))
	mux.HandleFunc("GET /api/auth/register-status", s.handleRegisterStatus)
	mux.HandleFunc("POST /api/auth/register", s.authRateLimit(loginBaseLimit, "register", s.handleRegister))
	mux.HandleFunc("GET /api/auth/register-invite/{token}", s.authRateLimit(loginBaseLimit, "register-invite-status", s.handleGetRegisterInvite))
	mux.HandleFunc("POST /api/auth/register-invite/{token}", s.authRateLimit(loginBaseLimit, "register-invite", s.handleRegisterInvite))
	mux.HandleFunc("GET /api/certificates/{publicId}", s.handlePublicCertificate)
	mux.HandleFunc("GET /api/community", s.handleCommunity)
	mux.HandleFunc("GET /api/sponsors", s.handleGetSponsors)
	mux.HandleFunc("GET /api/exports/chats/{token}", s.ipRateLimit(chatExportRateLimit, chatExportRateKey, s.handleExternalChatExport))

	// ---- authenticated ----
	mux.HandleFunc("GET /api/auth/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("POST /api/auth/logout", s.requireAuth(s.handleLogout))
	mux.HandleFunc("PUT /api/me/avatar", s.requireAuth(s.handlePutAvatar))
	mux.HandleFunc("POST /api/me/avatar-photo", s.requireAuth(s.perUserRateLimit(uploadRateLimit, "upload", s.handleAvatarPhotoUpload)))
	mux.HandleFunc("GET /api/me/certificate", s.requireAuth(s.handleMyCertificate))
	mux.HandleFunc("POST /api/me/certificate/issue", s.requireAuth(s.handleIssueCertificate))
	mux.HandleFunc("POST /api/me/certificate/physical", s.requireAuth(s.handleRequestPhysicalCertificate))

	mux.HandleFunc("GET /api/tree", s.requireAuth(s.handleTree))

	mux.HandleFunc("GET /api/lessons/{id}", s.requireAuth(s.handleLesson))
	mux.HandleFunc("GET /api/lessons/{id}/resume", s.requireAuth(s.handleResume))
	mux.HandleFunc("POST /api/lessons/{id}/heartbeat", s.requireAuth(s.lockedEnforce(s.handleHeartbeat)))
	mux.HandleFunc("POST /api/lessons/{id}/complete", s.requireAuth(s.handleComplete))
	mux.HandleFunc("GET /api/lessons/{id}/quiz", s.requireAuth(s.handleQuiz))
	mux.HandleFunc("POST /api/lessons/{id}/quiz/submit", s.requireAuth(s.lockedEnforce(s.handleQuizSubmit)))
	mux.HandleFunc("GET /api/lessons/{id}/quiz/result", s.requireAuth(s.handleQuizResult))

	mux.HandleFunc("GET /api/leaderboard/weekly", s.requireAuth(s.handleWeeklyLeaderboard))
	mux.HandleFunc("GET /api/challenges", s.requireAuth(s.handleListChallenges))

	mux.HandleFunc("GET /api/events", s.requireAuth(s.handleListEvents))
	mux.HandleFunc("GET /api/events/{id}", s.requireAuth(s.handleGetEvent))
	mux.HandleFunc("GET /api/events/{id}/ics", s.requireAuth(s.handleEventICS))
	mux.HandleFunc("POST /api/events/{id}/rsvp", s.requireAuth(s.handleRsvp))
	mux.HandleFunc("DELETE /api/events/{id}/rsvp", s.requireAuth(s.handleUnrsvp))

	mux.HandleFunc("GET /api/mentors", s.requireAuth(s.handleListMentors))
	mux.HandleFunc("GET /api/chats/conversations", s.requireAuth(s.handleConversations))
	mux.HandleFunc("GET /api/chats/{partner}/messages", s.requireAuth(s.handleChatMessages))
	mux.HandleFunc("POST /api/chats/{partner}/messages", s.requireAuth(s.handleChatSend))
	mux.HandleFunc("PUT /api/chats/{partner}/messages/{id}", s.requireAuth(s.handleChatEdit))
	mux.HandleFunc("DELETE /api/chats/{partner}/messages/{id}", s.requireAuth(s.handleChatDelete))
	mux.HandleFunc("GET /api/users/{id}", s.requireAuth(s.handlePublicProfile))
	mux.HandleFunc("POST /api/chats/{partner}/messages/{id}/reaction", s.requireAuth(s.handleChatReact))
	mux.HandleFunc("POST /api/chats/{partner}/messages/{id}/pin", s.requireAuth(s.handleChatPin))
	mux.HandleFunc("POST /api/chats/upload", s.requireAuth(s.perUserRateLimit(uploadRateLimit, "upload", s.handleChatUpload)))
	mux.HandleFunc("POST /api/chats/{partner}/read", s.requireAuth(s.handleChatRead))

	mux.HandleFunc("GET /api/notifications", s.requireAuth(s.handleListNotifications))
	mux.HandleFunc("GET /api/notifications/unread-count", s.requireAuth(s.handleUnreadCount))
	mux.HandleFunc("POST /api/notifications/read-all", s.requireAuth(s.handleMarkAllRead))
	mux.HandleFunc("POST /api/notifications/{id}/read", s.requireAuth(s.handleMarkRead))
	mux.HandleFunc("GET /api/notifications/preferences", s.requireAuth(s.handleGetPrefs))
	mux.HandleFunc("PUT /api/notifications/preferences", s.requireAuth(s.handlePutPrefs))

	mux.HandleFunc("POST /api/me/request-unlock", s.requireAuth(s.handleRequestUnlock))
	mux.HandleFunc("POST /api/me/request-reset", s.requireAuth(s.handleRequestReset))

	mux.HandleFunc("GET /api/ws", s.handleWS)

	// ---- admin / mentor ----
	admin := func(next http.HandlerFunc) http.HandlerFunc { return s.requireRole(models.RoleAdmin)(next) }
	staff := func(next http.HandlerFunc) http.HandlerFunc {
		return s.requireRole(models.RoleAdmin, models.RoleMentor)(next)
	}

	// Signed arbitrary keys: staff only (students get lesson URLs from GET /api/lessons/{id}).
	mux.HandleFunc("GET /api/media/sign", staff(s.handleSignMedia))

	mux.HandleFunc("GET /api/admin/stats", admin(s.handleAdminStats))
	mux.HandleFunc("GET /api/admin/learning/overview", staff(s.handleLearningOverview))
	mux.HandleFunc("GET /api/admin/learning/students", staff(s.handleLearningStudents))
	mux.HandleFunc("GET /api/admin/users/{id}/learning", staff(s.handleUserLearning))
	// Account administration is admin-only; mentors may unlock locked students only.
	mux.HandleFunc("GET /api/admin/users", admin(s.handleAdminListUsers))
	mux.HandleFunc("GET /api/admin/users/{id}", admin(s.handleAdminGetUser))
	mux.HandleFunc("POST /api/admin/users", admin(s.handleAdminCreateUser))
	mux.HandleFunc("POST /api/admin/users/{id}/lock", admin(s.handleAdminLockUser))
	mux.HandleFunc("POST /api/admin/users/{id}/unlock", staff(s.handleAdminUnlockUser))
	mux.HandleFunc("PUT /api/admin/users/{id}", admin(s.handleAdminUpdateUser))
	mux.HandleFunc("DELETE /api/admin/users/{id}", admin(s.handleAdminDeleteUser))
	mux.HandleFunc("POST /api/admin/users/{id}/role", admin(s.handleAdminSetRole))
	mux.HandleFunc("POST /api/admin/users/{id}/reset-password", admin(s.handleAdminResetPassword))
	mux.HandleFunc("GET /api/admin/physical-orders", admin(s.handleAdminListPhysicalOrders))
	mux.HandleFunc("PUT /api/admin/physical-orders/{id}", admin(s.handleAdminUpdatePhysicalOrder))
	mux.HandleFunc("GET /api/admin/settings", admin(s.handleAdminGetSettings))
	mux.HandleFunc("PUT /api/admin/settings", admin(s.handleAdminPutSettings))
	mux.HandleFunc("GET /api/admin/chat-export", admin(s.handleAdminChatExport))
	mux.HandleFunc("GET /api/admin/chat-export/stats", admin(s.handleAdminChatExportStats))
	mux.HandleFunc("POST /api/admin/chat-export/restore", admin(s.handleAdminChatExportRestore))
	mux.HandleFunc("GET /api/admin/chat-export/tokens", admin(s.handleAdminListChatExportTokens))
	mux.HandleFunc("POST /api/admin/chat-export/tokens", admin(s.handleAdminCreateChatExportToken))
	mux.HandleFunc("POST /api/admin/chat-export/tokens/{id}/revoke", admin(s.handleAdminRevokeChatExportToken))
	mux.HandleFunc("GET /api/admin/invites", admin(s.handleAdminListInvites))
	mux.HandleFunc("POST /api/admin/invites", admin(s.handleAdminCreateInvite))
	mux.HandleFunc("PUT /api/admin/invites/{id}", admin(s.handleAdminUpdateInvite))
	mux.HandleFunc("POST /api/admin/invites/{id}/pause", admin(s.handleAdminPauseInvite))
	mux.HandleFunc("POST /api/admin/invites/{id}/resume", admin(s.handleAdminResumeInvite))
	mux.HandleFunc("POST /api/admin/invites/{id}/revoke", admin(s.handleAdminRevokeInvite))
	mux.HandleFunc("GET /api/admin/phone-whitelist", admin(s.handleAdminListWhitelist))
	mux.HandleFunc("POST /api/admin/phone-whitelist/import", admin(s.handleAdminImportWhitelist))
	mux.HandleFunc("DELETE /api/admin/phone-whitelist/{id}", admin(s.handleAdminDeleteWhitelist))
	mux.HandleFunc("GET /api/admin/phone-blacklist", admin(s.handleAdminListBlacklist))
	mux.HandleFunc("GET /api/admin/phone-blacklist/attempts", admin(s.handleAdminListBlacklistAttempts))
	mux.HandleFunc("POST /api/admin/phone-blacklist/import", admin(s.handleAdminImportBlacklist))
	mux.HandleFunc("DELETE /api/admin/phone-blacklist/{id}", admin(s.handleAdminDeleteBlacklist))

	mux.HandleFunc("GET /api/admin/chapters", staff(s.handleAdminListChapters))
	mux.HandleFunc("POST /api/admin/chapters", staff(s.handleAdminCreateChapter))
	mux.HandleFunc("PUT /api/admin/chapters/{id}", staff(s.handleAdminUpdateChapter))
	mux.HandleFunc("DELETE /api/admin/chapters/{id}", staff(s.handleAdminDeleteChapter))

	mux.HandleFunc("GET /api/admin/lessons", staff(s.handleAdminListLessons))
	mux.HandleFunc("POST /api/admin/lessons", staff(s.handleAdminCreateLesson))
	mux.HandleFunc("PUT /api/admin/lessons/{id}", staff(s.handleAdminUpdateLesson))
	mux.HandleFunc("DELETE /api/admin/lessons/{id}", staff(s.handleAdminDeleteLesson))
	mux.HandleFunc("GET /api/admin/lessons/{id}/questions", staff(s.handleAdminListQuestions))
	mux.HandleFunc("POST /api/admin/lessons/{id}/questions", staff(s.handleAdminCreateQuestion))
	mux.HandleFunc("PUT /api/admin/questions/{id}", staff(s.handleAdminUpdateQuestion))
	mux.HandleFunc("DELETE /api/admin/questions/{id}", staff(s.handleAdminDeleteQuestion))

	mux.HandleFunc("GET /api/admin/videos", staff(s.handleAdminListVideos))
	mux.HandleFunc("POST /api/admin/videos", staff(s.handleAdminUploadVideo))
	mux.HandleFunc("DELETE /api/admin/videos", staff(s.handleAdminDeleteVideo))

	mux.HandleFunc("GET /api/admin/events", staff(s.handleAdminListEvents))
	mux.HandleFunc("POST /api/admin/events", staff(s.handleAdminCreateEvent))
	mux.HandleFunc("PUT /api/admin/events/{id}", staff(s.handleAdminUpdateEvent))
	mux.HandleFunc("DELETE /api/admin/events/{id}", staff(s.handleAdminDeleteEvent))

	mux.HandleFunc("GET /api/admin/challenges", admin(s.handleAdminListChallenges))
	mux.HandleFunc("POST /api/admin/challenges", admin(s.handleAdminCreateChallenge))
	mux.HandleFunc("PUT /api/admin/challenges/{id}", admin(s.handleAdminUpdateChallenge))
	mux.HandleFunc("DELETE /api/admin/challenges/{id}", admin(s.handleAdminDeleteChallenge))

	mux.HandleFunc("POST /api/admin/announce", admin(s.handleAdminAnnounce))
	mux.HandleFunc("GET /api/admin/announcements", admin(s.handleAdminListAnnouncements))
	mux.HandleFunc("PUT /api/admin/announcements/{id}", admin(s.handleAdminUpdateAnnouncement))
	mux.HandleFunc("DELETE /api/admin/announcements/{id}", admin(s.handleAdminDeleteAnnouncement))
	mux.HandleFunc("GET /api/admin/bots", admin(s.handleAdminListBots))
	mux.HandleFunc("POST /api/admin/bots", admin(s.handleCreateBot))
	mux.HandleFunc("PUT /api/admin/bots/{id}", admin(s.handleAdminSetBotActive))
	mux.HandleFunc("GET /api/announcements/pinned", s.requireAuth(s.handlePinnedAnnouncement))
	mux.HandleFunc("PUT /api/chats/{partner}/prefs", s.requireAuth(s.handleChatPrefs))
	mux.HandleFunc("POST /api/chats/mute-all", s.requireAuth(s.handleChatMuteAll))
	mux.HandleFunc("GET /api/chats/{partner}/peek", s.requireAuth(s.handleChatPeek))
	mux.HandleFunc("POST /api/chats/{partner}/unread", s.requireAuth(s.handleChatUnread))
	mux.HandleFunc("DELETE /api/chats/{partner}", s.requireAuth(s.handleChatDeleteBoth))
	mux.HandleFunc("POST /api/chats/broadcast", s.requireAuth(s.handleChatBroadcast))
	mux.HandleFunc("GET /api/me/saved", s.requireAuth(s.handleListSaved))
	mux.HandleFunc("POST /api/me/saved", s.requireAuth(s.handleSaveMessage))
	mux.HandleFunc("GET /api/me/profile", s.requireAuth(s.handleGetMeProfile))
	mux.HandleFunc("PUT /api/me/profile", s.requireAuth(s.handlePutMeProfile))
	mux.HandleFunc("PUT /api/me/account", s.requireAuth(s.handleUpdateAccount))
	mux.HandleFunc("POST /api/me/freeze", s.requireAuth(s.handleFreezeAccount))
	mux.HandleFunc("POST /api/me/unfreeze", s.requireAuth(s.handleUnfreezeAccount))
	mux.HandleFunc("PUT /api/me/username", s.requireAuth(s.handleUpdateUsername))
	mux.HandleFunc("GET /api/me/achievements", s.requireAuth(s.handleMeAchievements))
	mux.HandleFunc("GET /api/me/activity", s.requireAuth(s.handleMeActivity))
	mux.HandleFunc("GET /api/me/export", s.requireAuth(s.handleMeExport))
	mux.HandleFunc("GET /api/search", s.requireAuth(s.handleSearch))
	mux.HandleFunc("GET /api/meta", s.handleMeta)
	mux.HandleFunc("POST /api/bot/send", s.handleBotSend)
	mux.HandleFunc("GET /api/bot/updates", s.handleBotUpdates)

	return mux
}
