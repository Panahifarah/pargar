package api

import (
	"testing"
	"time"
)

func TestGregorianToJalaliKnownDates(t *testing.T) {
	cases := []struct {
		y, m, d    int
		jy, jm, jd int
	}{
		{2026, 3, 21, 1405, 1, 1},
		{2026, 10, 10, 1405, 7, 18},
		{2024, 3, 20, 1403, 1, 1},
	}
	for _, c := range cases {
		jy, jm, jd := gregorianToJalali(c.y, c.m, c.d)
		if jy != c.jy || jm != c.jm || jd != c.jd {
			t.Fatalf("%04d-%02d-%02d: got %d-%d-%d want %d-%d-%d", c.y, c.m, c.d, jy, jm, jd, c.jy, c.jm, c.jd)
		}
	}
	stamp := formatJalaliStamp(time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC))
	if stamp != "۱ فروردین · ۱۵:۳۰" {
		t.Fatalf("stamp: %q", stamp)
	}
}
