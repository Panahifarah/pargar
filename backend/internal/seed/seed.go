package seed

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"pargar/backend/internal/models"
	"pargar/backend/internal/store"
)

var demoEmails = []string{
	"student@pargar.dev",
	"mentor@pargar.dev",
	"admin@pargar.dev",
}

// Run ensures the bootstrap admin exists, removes legacy demo accounts,
// and optionally seeds an idempotent curriculum when the database is empty.
func Run(ctx context.Context, st *store.Store, allowCurriculumSeed bool) error {
	if err := purgeDemoUsers(ctx, st); err != nil {
		return err
	}
	if err := ensureBootstrapAdmin(ctx, st); err != nil {
		return err
	}

	if !allowCurriculumSeed {
		return nil
	}

	chapters, _ := st.ListChapters(ctx)
	if len(chapters) > 0 {
		return nil
	}

	if err := seedCurriculum(ctx, st); err != nil {
		return err
	}
	return seedEvents(ctx, st)
}

func purgeDemoUsers(ctx context.Context, st *store.Store) error {
	for _, email := range demoEmails {
		u, err := st.GetUserByEmail(ctx, email)
		if err != nil {
			continue
		}
		if err := st.DeleteUser(ctx, u.ID); err != nil {
			return err
		}
		log.Printf("removed legacy demo user %s", email)
	}
	return nil
}

func ensureBootstrapAdmin(ctx context.Context, st *store.Store) error {
	name := envOr("ADMIN_NAME", "Admin")
	username := strings.ToLower(envOr("ADMIN_USERNAME", "admin"))
	email := strings.ToLower(envOr("ADMIN_EMAIL", "admin@example.com"))
	password := os.Getenv("ADMIN_PASSWORD")
	if password == "" {
		if strings.EqualFold(envOr("DEV_MODE", "false"), "false") {
			return fmt.Errorf("ADMIN_PASSWORD must be set when DEV_MODE is false")
		}
		password = "dev-only-admin-password"
	}

	// Never re-apply ADMIN_PASSWORD (or profile fields) on restart — that undoes
	// password changes made in the admin UI. Only create when missing.
	if _, err := st.GetUserByEmail(ctx, email); err == nil {
		return nil
	}
	if _, err := st.GetUserByUsername(ctx, username); err == nil {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if _, err := st.CreateUser(ctx, name, email, username, string(hash), "", "", "", models.RoleAdmin); err != nil {
		return err
	}
	log.Printf("bootstrap admin ready: %s (%s)", email, username)
	return nil
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func seedCurriculum(ctx context.Context, st *store.Store) error {
	chapters := []struct {
		title, desc, icon string
		order             int
	}{
		{"هفتهٔ ۱ · مبانی", "ترمینال، گیت و ذهنیت مهندسی.", "terminal", 1},
		{"هفتهٔ ۲ · سامانه‌های اصلی", "سازوکار درونی کد و ماشین‌ها.", "chip", 2},
		{"هفتهٔ ۳ · ساخت و انتشار", "کار روی پروژه، استقرار و بازبینی.", "rocket", 3},
	}
	var chapterIDs []int64
	for _, c := range chapters {
		ch := &models.Chapter{Title: c.title, Description: c.desc, Icon: c.icon, SortOrder: c.order}
		id, err := st.CreateChapter(ctx, ch)
		if err != nil {
			return err
		}
		chapterIDs = append(chapterIDs, id)
	}

	type lessonDef struct {
		chapter  int
		title    string
		desc     string
		requires int64 // 0 = root
		x        int
		y        int
		xp       int
	}
	defs := []lessonDef{
		{0, "به پرگار خوش آمدید", "فلسفهٔ دوره، برنامهٔ زمانی و پیمان نظم.", 0, 0, 0, 50},
		{0, "مبانی شل و گیت", "کار با ترمینال و کنترل نسخه در نخستین مخزن شما.", 1, 1, 0, 60},
		{0, "مبانی شبکه", "رایانه‌ها چگونه با هم ارتباط می‌گیرند: TCP/IP، DNS و HTTP.", 1, 1, 1, 60},
		{1, "ساختمان داده ۱۰۱", "آرایه‌ها، هش‌ها و هنر انتخاب گزینهٔ درست.", 2, 2, 0, 70},
		{1, "راه‌اندازی ابزارها", "فایل‌های تنظیمات، ویرایشگرها و محیط توسعهٔ تکرارپذیر.", 2, 0, 2, 70},
		{2, "پروژه: انتشار یک CLI", "از مشخصات پروژه تا ابزار خط فرمان آمادهٔ انتشار.", 4, 3, 1, 100},
	}

	lessonIDs := map[int64]int64{}
	for i, d := range defs {
		var req *int64
		if d.requires != 0 {
			rid := lessonIDs[d.requires]
			req = &rid
		}
		l := &models.Lesson{
			ChapterID:              chapterIDs[d.chapter],
			Title:                  d.title,
			Description:            d.desc,
			VideoKey:               "sample.mp4",
			DurationSeconds:        45,
			CompletionThresholdPct: 85,
			RequiresLessonID:       req,
			X:                      d.x, Y: d.y,
			SortOrder: d.y,
			XPReward:  d.xp,
			IsActive:  true,
		}
		id, err := st.CreateLesson(ctx, l)
		if err != nil {
			return err
		}
		lessonIDs[int64(i)+1] = id
		if err := seedQuestions(ctx, st, id, d.title); err != nil {
			return err
		}
	}
	return nil
}

func seedQuestions(ctx context.Context, st *store.Store, lessonID int64, lessonTitle string) error {
	templates := []struct {
		q       string
		opts    []string
		answer  int
		explain string
	}{
		{"درس " + quote(lessonTitle) + " چه چیزی به شما می‌آموزد؟", []string{
			"تماشای منفعلانهٔ محتوا",
			"مهارت عملی و تأییدشده از مسیر نظم",
			"پرش از بخش‌ها در هر زمان ممکن",
			"هیچ‌چیز؛ این فقط یک جای خالی است",
		}, 1, "پرگار بر توانمندی عملی و قابل‌سنجش تمرکز دارد، نه تماشای منفعلانه."},
		{"چرا پیش از باز شدن آزمون‌ها، زمان تماشای تأییدشده لازم است؟", []string{
			"تا عمداً سرعت پیشرفت هنرجو کم شود",
			"تا مطمئن شویم واقعاً با محتوای درس درگیر شده‌اید",
			"چون ویدیوها خسته‌کننده‌اند",
			"برای فروش جان بیشتر",
		}, 1, "زمان تماشای تأییدشده نشان می‌دهد پیش از آزمون واقعاً با محتوا کار کرده‌اید."},
		{"وقتی هر ۳ جان خود را از دست بدهید چه اتفاقی می‌افتد؟", []string{
			"هیچ؛ جان‌ها بلافاصله برمی‌گردند",
			"امتیاز اضافه می‌گیرید",
			"حساب شما تا بررسی متصدی محدود می‌شود",
			"یک درس مخفی برایتان باز می‌شود",
		}, 2, "با تمام شدن جان‌ها، حساب تا بررسی متصدی محدود می‌شود."},
	}
	for pos, t := range templates {
		q := &models.MCQQuestion{
			LessonID:    lessonID,
			Position:    pos + 1,
			Question:    t.q,
			Options:     t.opts,
			AnswerIndex: t.answer,
			Explanation: t.explain,
		}
		if _, err := st.CreateQuestion(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

func quote(s string) string {
	return "\"" + s + "\""
}

func seedEvents(ctx context.Context, st *store.Store) error {
	now := time.Now()
	events := []models.Event{
		{
			Title: "آغاز زنده — هفتهٔ ۱", Description: "جلسهٔ معارفه، نقشهٔ مسیر دوره و انتظارات.",
			EventType: "workshop", ExternalURL: "https://meet.google.com/pargar-kickoff",
			StartsAt: now.Add(2 * time.Hour), EndsAt: now.Add(3 * time.Hour), IsActive: true,
		},
		{
			Title: "ساعت گفتگوی منتور", Description: "برای پرسش، بازبینی کد و رفع محدودیت حساب وارد شوید.",
			EventType: "meet", ExternalURL: "https://meet.google.com/pargar-office",
			StartsAt: now.Add(24 * time.Hour), EndsAt: now.Add(25 * time.Hour), IsActive: true,
		},
		{
			Title: "کارگاه پروژه: انتشار یک CLI", Description: "ساخت زندهٔ نخستین پروژه با همراهی منتور.",
			EventType: "zoom", ExternalURL: "https://meet.google.com/pargar-cli",
			StartsAt: now.Add(96 * time.Hour), EndsAt: now.Add(98 * time.Hour), IsActive: true,
		},
	}
	adminEmail := strings.ToLower(envOr("ADMIN_EMAIL", "admin@example.com"))
	for i := range events {
		e := &events[i]
		admin, _ := st.GetUserByEmail(ctx, adminEmail)
		if admin != nil {
			id := admin.ID
			e.CreatedBy = &id
		}
		if _, err := st.CreateEvent(ctx, e); err != nil {
			return err
		}
	}
	log.Println("seeded curriculum and events")
	return nil
}
