package service

import (
	"testing"
	"time"

	"pargar/backend/internal/models"
)

func TestHeartbeatCapsDelta(t *testing.T) {
	lesson := &models.Lesson{ID: 1, DurationSeconds: 100, CompletionThresholdPct: 85}
	delta := 999.0
	if delta > maxHeartbeatDelta {
		delta = maxHeartbeatDelta
	}
	if delta > float64(lesson.DurationSeconds) {
		delta = float64(lesson.DurationSeconds)
	}
	if delta != maxHeartbeatDelta {
		t.Fatalf("expected cap %v, got %v", maxHeartbeatDelta, delta)
	}
}

func TestHeartbeatCapsDeltaByWallClock(t *testing.T) {
	last := time.Now().Add(-2 * time.Second)
	elapsed := time.Since(last).Seconds()
	wallCap := elapsed + wallClockSlack
	delta := 15.0
	if delta > wallCap {
		delta = wallCap
	}
	if delta > maxHeartbeatDelta {
		delta = maxHeartbeatDelta
	}
	if delta > 5 {
		t.Fatalf("wall-clock cap should keep delta near ~3.5s, got %v", delta)
	}
	if delta < 2 {
		t.Fatalf("wall-clock cap too aggressive: %v", delta)
	}
}

func TestMaxHeartbeatDeltaConstant(t *testing.T) {
	if maxHeartbeatDelta != 15.0 {
		t.Fatalf("maxHeartbeatDelta changed unexpectedly: %v", maxHeartbeatDelta)
	}
	if wallClockSlack < 1 {
		t.Fatalf("wallClockSlack too small: %v", wallClockSlack)
	}
}
