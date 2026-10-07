package config

import (
	"os"
	"strings"
	"testing"
)

func TestValidateRejectsPlaceholderSecrets(t *testing.T) {
	t.Setenv("DEV_MODE", "false")
	t.Setenv("JWT_SECRET", "change-me-to-at-least-32-characters-long")
	t.Setenv("ADMIN_PASSWORD", "change-me-strong-admin-password")
	t.Setenv("STORAGE_ACCESS_KEY", "ak")
	t.Setenv("STORAGE_SECRET_KEY", "change-me-long-rustfs-secret")

	cfg := Load()
	cfg.DevMode = false
	cfg.StorageDriver = "s3"
	cfg.StorageAccess = "ak"
	cfg.StorageSecret = "change-me-long-rustfs-secret"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected Validate to reject placeholder JWT")
	}
}

func TestValidateAcceptsStrongSecrets(t *testing.T) {
	t.Setenv("DEV_MODE", "false")
	jwt := strings.Repeat("a1B2c3D4", 6) // 48 chars, no placeholder markers
	t.Setenv("JWT_SECRET", jwt)
	t.Setenv("ADMIN_PASSWORD", "Tr0ub4dor&3-not-default")
	cfg := Load()
	cfg.DevMode = false
	cfg.StorageDriver = "s3"
	cfg.StorageAccess = "AKIAEXAMPLE"
	cfg.StorageSecret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
}

func TestResolveDatabaseURLEncodesPassword(t *testing.T) {
	os.Unsetenv("DATABASE_URL")
	t.Setenv("POSTGRES_USER", "pargar")
	t.Setenv("POSTGRES_PASSWORD", "p@ss:word/with%chars")
	t.Setenv("POSTGRES_HOST", "db.internal")
	t.Setenv("POSTGRES_DB", "pargar")
	t.Setenv("POSTGRES_SSLMODE", "disable")
	u := resolveDatabaseURL()
	if !strings.Contains(u, "p%40ss%3Aword%2Fwith%25chars") {
		t.Fatalf("password not encoded in URL: %s", u)
	}
	if !strings.Contains(u, "@db.internal:") {
		t.Fatalf("host missing: %s", u)
	}
}

func TestResolveRedisURLEncodesPassword(t *testing.T) {
	os.Unsetenv("REDIS_URL")
	t.Setenv("REDIS_HOST", "redis.internal")
	t.Setenv("REDIS_PASSWORD", "r@dis:pass")
	u := resolveRedisURL()
	if !strings.Contains(u, "%40") || !strings.Contains(u, "%3A") {
		t.Fatalf("redis password not encoded: %s", u)
	}
}

func TestIsInsecureSecret(t *testing.T) {
	if !isInsecureSecret("change-me-postgres") {
		t.Fatal("expected change-me to be insecure")
	}
	if isInsecureSecret(strings.Repeat("xY9k", 12)) {
		t.Fatal("random-looking secret should be ok")
	}
}
