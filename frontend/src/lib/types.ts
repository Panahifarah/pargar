export type Role = "student" | "mentor" | "admin";

export interface User {
  id: number;
  email: string;
  username: string;
  name: string;
  role: Role;
  xp: number;
  hearts: number;
  heartsUpdatedAt: string;
  streakCurrent: number;
  streakLongest: number;
  isLocked: boolean;
  lockedAt?: string;
  isActive: boolean;
  avatarVariant?: "marble" | "beam" | "pixel" | "sunset" | "ring" | "bauhaus";
  avatarPalette?: string;
  avatarPhoto?: string;
  phone?: string;
  securityQuestion?: string;
  hasSecurityAnswer?: boolean;
  createdAt: string;
  usernameChangesRemaining?: number;
  usernameCooldownUntil?: string;
  frozenAt?: string;
  closedAt?: string;
  closesAt?: string;
  isFrozen?: boolean;
  isClosed?: boolean;
}

export interface Certificate {
  id: number;
  userId: number;
  publicId: string;
  fullName: string;
  issuedAt: string;
  revokedAt?: string;
}

export type PhysicalOrderStatus = "requested" | "paid" | "shipped" | "cancelled";

export interface CertificatePhysicalOrder {
  id: number;
  certificateId: number;
  userId: number;
  status: PhysicalOrderStatus;
  note: string;
  recipientName: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  trackingCode: string;
  windowEndsAt: string;
  createdAt: string;
  updatedAt: string;
  userName?: string;
  publicId?: string;
}

export interface PhysicalCertSettings {
  enabled: boolean;
  priceIrr: number;
  windowDays: number;
}

export interface LessonProgress {
  userId: number;
  lessonId: number;
  watchedSeconds: number;
  watchedPct: number;
  lastPosition: number;
  quizUnlocked: boolean;
  passedQuiz: boolean;
  quizCompletedAt?: string;
}

export interface Lesson {
  id: number;
  chapterId: number;
  title: string;
  description: string;
  videoKey: string;
  durationSeconds: number;
  completionThresholdPct: number;
  requiresLessonId?: number;
  x: number;
  y: number;
  sortOrder: number;
  xpReward: number;
  isActive: boolean;
}

export interface Chapter {
  id: number;
  title: string;
  description: string;
  icon: string;
  sortOrder: number;
}

export interface TreeLesson {
  id: number;
  title: string;
  description: string;
  progress?: LessonProgress;
  quizStatus: "" | "in_progress" | "passed" | "failed";
  locked: boolean;
  requiresLessonId?: number;
  x: number;
  y: number;
  xpReward: number;
  durationSeconds: number;
  chapterId: number;
}

export interface TreeChapter extends Chapter {
  lessons: TreeLesson[];
}

export interface TreeData {
  chapters: TreeChapter[];
  me: { xp: number; streak: number; hearts: number; isLocked: boolean; role: Role };
}

export interface QuizQuestion {
  id: number;
  position: number;
  question: string;
  options: string[];
}

export interface QuizData {
  lessonID: number;
  duration: number;
  questions: QuizQuestion[];
  passed: boolean;
  quizStatus: string;
  lastAttempt?: {
    id: number;
    correctCount: number;
    total: number;
    status: string;
    createdAt: string;
  } | null;
}

export interface QuizResult {
  passed: boolean;
  correctCount: number;
  total: number;
  heartsLost: number;
  heartsLeft: number;
  xpEarned: number;
  locked: boolean;
  wasLocked: boolean;
  streak: number;
}

export interface MeetingEvent {
  id: number;
  title: string;
  description: string;
  eventType: "meet" | "zoom" | "workshop";
  externalUrl: string;
  startsAt: string;
  endsAt: string;
  rsvped?: boolean;
}

export interface NotificationItem {
  id: number;
  category: string;
  type: string;
  title: string;
  body: string;
  route: string;
  data: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

export interface ChatAttachment {
  type: "image" | "video" | "audio" | "file";
  url: string;
  name: string;
  size: number;
}

export interface ChatMessage {
  id: number;
  userId: number;
  mentorId: number;
  senderRole: Role;
  body: string;
  readAt?: string;
  createdAt: string;
  replyTo?: number;
  pinnedAt?: string;
  pinned?: boolean;
  editedAt?: string;
  attachment?: ChatAttachment;
  attachments?: ChatAttachment[];
  reactions?: ChatReaction[];
  buttons?: { text: string }[];
}

export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface Mentor {
  id: number;
  name: string;
  email: string;
  role: Role;
  online?: boolean;
  lastSeen?: string;
  avatarVariant?: "marble" | "beam" | "pixel" | "sunset" | "ring" | "bauhaus";
  avatarPalette?: string;
  avatarPhoto?: string;
}

export interface Conversation {
  partner: {
    id: number;
    name: string;
    email: string;
    role: Role;
    online?: boolean;
    lastSeen?: string;
    saved?: boolean;
    avatarVariant?: "marble" | "beam" | "pixel" | "sunset" | "ring" | "bauhaus";
    avatarPalette?: string;
    avatarPhoto?: string;
  };
  lastMessage?: ChatMessage;
  unreadCount: number;
  messageCount?: number;
  pinnedRank: number | null;
  muted: boolean;
  archived: boolean;
}

export interface LeaderboardEntry {
  userId: number;
  name: string;
  email: string;
  xp: number;
  rank: number;
  avatarVariant?: "marble" | "beam" | "pixel" | "sunset" | "ring" | "bauhaus";
  avatarPalette?: string;
  avatarPhoto?: string;
}

export interface LeaderboardData {
  week: string;
  entries: LeaderboardEntry[];
  me: { rank: number; xp: number; streak: number };
}

export interface NotificationPrefs {
  userId: number;
  progress: boolean;
  gamification: boolean;
  mentor: boolean;
  event: boolean;
}

export interface MCQQuestion {
  id: number;
  lessonId: number;
  position: number;
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface PublicProfile {
  id: number;
  name: string;
  username?: string;
  role: Role;
  xp?: number;
  hearts?: number;
  streakCurrent?: number;
  streakLongest?: number;
  avatarVariant?: User["avatarVariant"];
  avatarPalette?: string;
  avatarPhoto?: string;
  isLocked?: boolean;
  isFrozen?: boolean;
  isClosed?: boolean;
  private?: boolean;
  public?: boolean;
  banner?: string;
  createdAt?: string;
  socialLinks?: { name: string; url: string }[];
}

export interface AdminStats {
  users: number;
  lessons: number;
  questions: number;
  events: number;
  completions: number;
}

export interface LearningOverview {
  studentsActive: number;
  studentsLocked: number;
  studentsTotal: number;
  lessonsTotal: number;
  completions: number;
  attempts7d: number;
  passes7d: number;
  passRate7d: number;
  avgWatchPct: number;
  xpAwarded7d: number;
  studentsStreaking: number;
}

export interface StudentLearningRow {
  id: number;
  name: string;
  username: string;
  email: string;
  xp: number;
  hearts: number;
  streakCurrent: number;
  isLocked: boolean;
  isActive: boolean;
  lessonsPassed: number;
  lessonsTotal: number;
  progressPct: number;
  attempts7d: number;
  passes7d: number;
  passRate7d: number;
  lastActivityAt?: string;
}

export interface LessonLearningDetail {
  lessonId: number;
  chapterId: number;
  chapterTitle: string;
  title: string;
  sortOrder: number;
  watchedPct: number;
  quizUnlocked: boolean;
  passedQuiz: boolean;
  quizCompletedAt?: string;
  lastAttemptStatus?: string;
  lastAttemptScore?: number;
}

export interface AttemptLearningDetail {
  id: number;
  lessonId: number;
  lessonTitle: string;
  correctCount: number;
  total: number;
  scorePct: number;
  status: string;
  heartsLost: number;
  createdAt: string;
}

export interface XPEventDetail {
  id: number;
  amount: number;
  source: string;
  refId: number;
  createdAt: string;
}

export interface WatchSessionDetail {
  lessonId: number;
  lessonTitle: string;
  startedAt: string;
  lastHeartbeatAt: string;
  lastPosition: number;
}

export interface UserLearningDetail {
  user: StudentLearningRow;
  lessons: LessonLearningDetail[];
  attempts: AttemptLearningDetail[];
  xpEvents: XPEventDetail[];
  sessions: WatchSessionDetail[];
}

export interface AdminEvent extends MeetingEvent {
  isActive: boolean;
  createdAt: string;
}

export type InviteStatus = "active" | "paused" | "revoked" | "exhausted";

export interface RegistrationInvite {
  id: number;
  label: string;
  maxUses: number;
  usedCount: number;
  remaining: number;
  status: InviteStatus;
  expiresAt?: string;
  createdBy?: number;
  createdAt: string;
  token?: string;
  url?: string;
}

export type WhitelistStatus = "available" | "consumed";

export interface RegistrationPhoneWhitelist {
  id: number;
  phone: string;
  status: WhitelistStatus;
  consumedAt?: string;
  consumedUserId?: number;
  createdBy?: number;
  createdAt: string;
}

export interface RegistrationPhoneBlacklist {
  id: number;
  phone: string;
  createdBy?: number;
  createdAt: string;
}

export interface RegistrationBlacklistAttempt {
  id: number;
  phone: string;
  path: "public" | "invite" | string;
  inviteId?: number;
  ip: string;
  userAgent?: string;
  attemptedUsername?: string;
  attemptedEmail?: string;
  attemptedAt: string;
}