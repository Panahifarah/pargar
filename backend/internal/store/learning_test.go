package store_test

import (
	"context"
	"os"
	"testing"

	"pargar/backend/internal/db"
	"pargar/backend/internal/store"
)

func TestLearningOverviewSmoke(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://pargar:f479ad70f076f25594b73b767691be4b295901c4430ed208@localhost:5432/pargar?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		t.Skip("postgres unavailable:", err)
	}
	defer pool.Close()
	st := store.New(pool)
	o, err := st.LearningOverview(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if o == nil {
		t.Fatal("nil overview")
	}
	students, err := st.ListStudentLearning(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	_ = students
}
